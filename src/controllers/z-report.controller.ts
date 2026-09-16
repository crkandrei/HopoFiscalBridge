import { Request, Response } from 'express';
import logger from '../utils/logger';
import ecrBridgeService from '../services/ecrBridge.service';
import { config } from '../config/config';
import { incrementZReportCount, incrementErrorCount } from '../services/metrics.service';

/** Cât așteptăm răspunsul casei la rapoarte — mai mult decât la un bon obișnuit. */
const REPORT_TIMEOUT = 30000;

type DepartmentReportStatus = 'skipped' | 'success' | 'error';

/**
 * Emits the department report (RD) that must precede the Z report.
 *
 * Nu blochează raportul Z: Z-ul e obligația fiscală, raportul pe departamente
 * e doar informativ. Dacă RD eșuează, spunem asta în răspuns și mergem mai departe.
 */
async function emitDepartmentReport(requestId: string): Promise<DepartmentReportStatus> {
  const filename = ecrBridgeService.generateDepartmentReportFile();

  if (!filename) {
    logger.error('Failed to generate department report file', { requestId });
    return 'error';
  }

  try {
    const response = await ecrBridgeService.waitForResponse(filename, 'RD', REPORT_TIMEOUT);

    if (!response.success) {
      logger.error('ECR Bridge returned error for department report', {
        requestId,
        filename,
        details: response.details,
      });
      return 'error';
    }

    logger.info('Department report emitted', { requestId, filename });
    return 'success';
  } catch (error) {
    logger.error('Error waiting for department report response', {
      requestId,
      filename,
      error: error instanceof Error ? error.message : String(error),
    });
    return 'error';
  }
}

/**
 * Handles POST /z-report request
 * Generates a Z report file in the Bon directory and waits for ECR response
 */
export async function handleZReportRequest(
  req: Request,
  res: Response
): Promise<void> {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  try {
    logger.info('Z Report request received', {
      requestId,
      ip: req.ip,
    });

    // Raportul pe departamente se poate emite numai înainte de raportul Z
    const departmentReport: DepartmentReportStatus = config.ecrBridge.departmentReportBeforeZ
      ? await emitDepartmentReport(requestId)
      : 'skipped';

    // Generate Z report file
    const filename = ecrBridgeService.generateZReportFile();
    
    if (!filename) {
      logger.error('Failed to generate Z report file', {
        requestId,
      });
      res.status(500).json({
        status: 'error',
        message: 'Eroare la generarea fișierului raport Z',
        details: 'Nu s-a putut crea fișierul pentru ECR Bridge',
      });
      return;
    }

    logger.info('Z Report file generated successfully, waiting for ECR response', {
      requestId,
      filename,
    });

    // Wait for ECR Bridge response
    // Pass "Z;1" as expected command to verify the error file corresponds to this Z report
    // Use longer timeout for Z reports (30 seconds) as they may take longer to process
    try {
      const response = await ecrBridgeService.waitForResponse(filename, 'Z;1', REPORT_TIMEOUT);

      if (response.success) {
        logger.info('Z Report request completed successfully', {
          requestId,
          filename,
        });
        incrementZReportCount();
        res.status(200).json({
          status: 'success',
          message: 'Z;1',
          file: filename,
          departmentReport,
        });
      } else {
        logger.error('ECR Bridge returned error for Z report', {
          requestId,
          filename,
          details: response.details,
        });
        incrementErrorCount();
        res.status(500).json({
          status: 'error',
          message: 'Eroare la generarea raportului Z',
          details: response.details || 'Eroare necunoscută de la ECR Bridge',
        });
      }
    } catch (error) {
      // Timeout or other error while waiting
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Timeout la așteptarea răspunsului de la ECR Bridge';
      
      logger.error('Error waiting for Z report response', {
        requestId,
        filename,
        error: errorMessage,
      });
      incrementErrorCount();
      res.status(504).json({
        status: 'error',
        message: 'Timeout la așteptarea răspunsului de la ECR Bridge',
        details: errorMessage,
      });
    }
  } catch (error) {
    logger.error('Error handling Z report request', {
      requestId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({
      status: 'error',
      message: 'Eroare internă la generarea raportului Z',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

