import path from 'path';
import fs from 'fs';
import { config } from '../config/config';
import logger from '../utils/logger';
import {
  writeFileSafe,
  readFileSafe,
  fileExists,
  ensureDirectoryExists,
} from '../utils/fileUtils';
import { PrintRequest } from '../utils/validator';
import { parseErrorFile } from '../utils/errorParser';

/**
 * Response from waiting for ECR Bridge response
 */
export interface ECRResponse {
  success: boolean;
  details?: string;
  filename: string;
}

/**
 * Service for interacting with ECR Bridge
 * Handles file generation and response monitoring
 */
class ECRBridgeService {
  /**
   * Lists directory contents for debugging
   * @param dirPath - Directory path to list
   * @returns Array of filenames or empty array on error
   */
  private listDirectoryContents(dirPath: string): string[] {
    try {
      if (!fs.existsSync(dirPath)) {
        return [];
      }
      return fs.readdirSync(dirPath);
    } catch (error) {
      logger.error(`Failed to list directory contents: ${dirPath}`, { error });
      return [];
    }
  }

  /**
   * Generates a unique timestamp for filename
   * Format: YYYYMMDDHHmmss
   */
  private generateTimestamp(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}${hours}${minutes}${seconds}`;
  }

  /**
   * Generates a Z Report file
   * Format: Z_YYYYMMDD_HHMMSS.txt with content "Z;1"
   * @returns The generated filename (without path) or null on error
   */
  public generateZReportFile(): string | null {
    try {
      // Ensure the Bon directory exists
      if (!ensureDirectoryExists(config.ecrBridge.bonPath)) {
        logger.error('Failed to ensure Bon directory exists');
        return null;
      }

      // Generate filename: Z_YYYYMMDD_HHMMSS.txt (with underscore between date and time)
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const seconds = String(now.getSeconds()).padStart(2, '0');
      const filename = `Z_${year}${month}${day}_${hours}${minutes}${seconds}.txt`;
      const filePath = path.join(config.ecrBridge.bonPath, filename);

      // File content is "Z;1" on a single line
      const content = 'Z;1';

      // Write file
      if (!writeFileSafe(filePath, content)) {
        logger.error('Failed to write Z report file', { filename, filePath });
        return null;
      }

      logger.info('Z Report file generated', {
        filename,
        filePath,
        content,
      });

      return filename;
    } catch (error) {
      logger.error('Error generating Z report file', { error });
      return null;
    }
  }

  /**
   * Generates the ECR Bridge file content according to mode
   * LIVE mode: Official Datecs fiscal format (FISCAL, I;, P;)
   * TEST mode: Non-fiscal test format (TEXT, T;)
   */
  private generateFileContent(data: PrintRequest, mode: 'live' | 'test'): string {
    const { paymentType, items } = data;
    
    // Calculate total price
    let totalPrice = 0;
    const receiptItems: Array<{ name: string; quantity: number; price: number; vatClass?: number }> = [];

    if (items && items.length > 0) {
      // New format: use items array
      items.forEach((item) => {
        receiptItems.push({
          name: item.name,
          quantity: item.quantity || 1,
          price: item.price,
          vatClass: item.vatClass,
        });
        totalPrice += item.price * (item.quantity || 1);
      });
    } else {
      // Legacy format: use productName/duration/price
      const { productName, duration, price } = data;
      if (!productName || duration === undefined || price === undefined) {
        throw new Error('Either items array or productName/duration/price must be provided');
      }
      receiptItems.push({
        name: `${productName} (${duration})`,
        quantity: 1,
        price: price,
      });
      totalPrice = price;
    }
    
    if (mode === 'live') {
      // Build header line: FISCAL or FISCAL;fiscalCode
      const fiscalCode = config.ecrBridge.fiscalCode;
      const headerLine = fiscalCode ? `FISCAL;${fiscalCode}` : 'FISCAL';
      
      // Generate item lines: I;name;qty;price;vat (one for each item)
      const itemLines = receiptItems.map((item) => {
        const formattedPrice = item.price.toString().replace(',', '.');
        const vatClass = item.vatClass ?? 1;
        return `I;${item.name};${item.quantity};${formattedPrice};${vatClass}`;
      });
      
      // Payment line: P;pay_code;value
      // pay_code: 1 = CASH (Numerar), 2 = CARD (Card) - conform documentației Datecs
      // value: 0 = pay total amount
      const paymentCode = paymentType === 'CASH' ? '1' : '2';
      const paymentLine = `P;${paymentCode};0`;
      
      // Combine all lines
      return `${headerLine}\n${itemLines.join('\n')}\n${paymentLine}`;
    } else {
      // TEST mode: Non-fiscal format
      // First line: TEXT
      const lines: string[] = ['TEXT'];
      
      // Product lines: T;<name>     <price>
      receiptItems.forEach((item) => {
        const formattedPrice = item.price.toString().replace(',', '.');
        const itemLine = `T;${item.name}${item.quantity > 1 ? ` x${item.quantity}` : ''}     ${formattedPrice}`;
        lines.push(itemLine);
      });
      
      // Separator
      lines.push('T;--------------------');
      
      // Total line: T;TOTAL: <total>
      const formattedTotal = totalPrice.toString().replace(',', '.');
      lines.push(`T;TOTAL: ${formattedTotal}`);
      
      // Voucher line (if voucher hours provided)
      if (data.voucherHours && data.voucherHours > 0) {
        const voucherHoursFormatted = data.voucherHours.toString().replace(',', '.');
        lines.push(`T;Voucher: ${voucherHoursFormatted}h`);
      }
      
      // Payment line: T;Plata: CASH or T;Plata: CARD
      const paymentText = paymentType === 'CASH' ? 'CASH' : 'CARD';
      lines.push(`T;Plata: ${paymentText}`);
      
      // Footer
      lines.push('T;Bon NON-FISCAL - TEST');
      
      return lines.join('\n');
    }
  }

  /**
   * Generates a receipt file for ECR Bridge
   * @param data - The print request data
   * @param mode - Bridge mode: 'live' for fiscal, 'test' for non-fiscal
   * @returns The generated filename (without path) or null on error
   */
  public generateReceiptFile(data: PrintRequest, mode: 'live' | 'test'): string | null {
    try {
      // Ensure the Bon directory exists
      if (!ensureDirectoryExists(config.ecrBridge.bonPath)) {
        logger.error('Failed to ensure Bon directory exists');
        return null;
      }

      // Generate unique filename
      const timestamp = this.generateTimestamp();
      const filename = `bon_${timestamp}.txt`;
      const filePath = path.join(config.ecrBridge.bonPath, filename);

      // Generate file content based on mode
      const content = this.generateFileContent(data, mode);

      // Write file
      if (!writeFileSafe(filePath, content)) {
        logger.error('Failed to write receipt file', { filename, filePath });
        return null;
      }

      const modeLabel = mode === 'live' ? 'Fiscal receipt' : 'Non-fiscal test receipt';
      logger.info(`Mode ${mode.toUpperCase()}: ${modeLabel}`, {
        filename,
        filePath,
        content,
        mode,
      });

      return filename;
    } catch (error) {
      logger.error('Error generating receipt file', { error, data, mode });
      return null;
    }
  }

  /**
   * Checks if a response file exists in a directory by listing directory contents
   * The file keeps the .txt extension and is moved to BonErr or BonOK
   * @param dirPath - Directory to check (BonErr or BonOK)
   * @param filename - The full filename with .txt extension (e.g., "bon_20251113020617.txt")
   * @returns Full path to file if found, null otherwise
   */
  private findResponseFile(
    dirPath: string,
    filename: string
  ): string | null {
    try {
      // File keeps .txt extension, just moved to different directory
      const directPath = path.join(dirPath, filename);
      if (fileExists(directPath)) {
        return directPath;
      }

      // If not found, list directory and search case-insensitively
      const dirContents = this.listDirectoryContents(dirPath);
      const filenameLower = filename.toLowerCase();
      const matchingFile = dirContents.find(f => {
        const fileLower = f.toLowerCase();
        return fileLower === filenameLower;
      });

      if (matchingFile) {
        return path.join(dirPath, matchingFile);
      }

      return null;
    } catch (error) {
      logger.error(`Error finding response file in ${dirPath}`, { error, filename });
      return null;
    }
  }

  /**
   * Waits for ECR Bridge response files
   * The file keeps .txt extension and is moved to BonOK (success) or BonErr (error)
   * @param filename - The receipt filename (e.g., "bon_123456.txt")
   * @param expectedCommand - The original command that was sent (for validation)
   * @param timeout - Maximum wait time in milliseconds
   * @returns Promise that resolves with response status
   */
  public async waitForResponse(
    filename: string,
    expectedCommand?: string,
    timeout: number = config.responseTimeout
  ): Promise<ECRResponse> {
    return new Promise((resolve, reject) => {
      // Normalize paths to handle Windows/Unix differences
      const bonOkPath = path.normalize(config.ecrBridge.bonOkPath);
      const bonErrPath = path.normalize(config.ecrBridge.bonErrPath);

      // Ensure response directories exist
      ensureDirectoryExists(bonOkPath);
      ensureDirectoryExists(bonErrPath);

      const startTime = Date.now();
      const pollInterval = 200; // Check every 200ms

      logger.info('Waiting for ECR Bridge response', {
        filename,
        bonOkPath,
        bonErrPath,
        timeout,
        note: 'File keeps .txt extension and is moved to BonOK or BonErr',
      });

      const checkInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;

        // Check for timeout first
        if (elapsed >= timeout) {
          clearInterval(checkInterval);
          
          // Final check before timeout - maybe files appeared just now
          const errFile = this.findResponseFile(bonErrPath, filename);
          const okFile = this.findResponseFile(bonOkPath, filename);
          
          if (errFile) {
            // Found error file at timeout - process it
            logger.warn('Found error file at timeout', {
              filename,
              errFile,
              elapsed,
            });
            const errorContent = readFileSafe(errFile);
            const parsedError = errorContent ? parseErrorFile(errorContent) : null;
            const errorMessage = parsedError?.errorMessage || errorContent || 'Unknown error from ECR Bridge';
            
            logger.error('ECR Bridge returned error (found at timeout)', {
              filename,
              errFile,
              errorMessage,
            });
            
            resolve({
              success: false,
              details: errorMessage,
              filename,
            });
            return;
          }
          
          if (okFile) {
            // Found OK file at timeout - process it
            logger.info('ECR Bridge returned success (found at timeout)', {
              filename,
              okFile,
              elapsed,
            });
            resolve({
              success: true,
              filename,
            });
            return;
          }
          
          // No files found - timeout
          logger.warn('Timeout waiting for ECR Bridge response', {
            filename,
            elapsed,
            timeout,
            bonOkPath,
            bonErrPath,
            okDirContents: this.listDirectoryContents(bonOkPath),
            errDirContents: this.listDirectoryContents(bonErrPath),
          });
          
          reject(
            new Error(
              `Timeout waiting for response after ${timeout}ms. File: ${filename}`
            )
          );
          return;
        }

        // Check BonErr first (errors have priority)
        // File keeps .txt extension, just moved to BonErr directory
        const errFile = this.findResponseFile(bonErrPath, filename);
        if (errFile) {
          clearInterval(checkInterval);
          
          // Read and parse error file
          const errorContent = readFileSafe(errFile);
          const parsedError = errorContent ? parseErrorFile(errorContent) : null;
          
          // Verify that the error file corresponds to the correct receipt
          if (expectedCommand && parsedError?.originalCommand) {
            const commandsMatch = parsedError.originalCommand.trim() === expectedCommand.trim();
            if (!commandsMatch) {
              logger.warn('Error file command mismatch - possible wrong error file', {
                filename,
                errFile,
                expectedCommand,
                errorFileCommand: parsedError.originalCommand,
              });
            } else {
              logger.debug('Error file command verified - matches expected command', {
                filename,
                expectedCommand,
              });
            }
          }
          
          const errorMessage = parsedError?.errorMessage || errorContent || 'Unknown error from ECR Bridge';
          
          // Log error details
          logger.error('ECR Bridge returned error', {
            filename,
            errFile,
            elapsed,
            errorContent,
            parsedError: parsedError ? {
              originalCommand: parsedError.originalCommand,
              timestamp: parsedError.timestamp,
              errorMessage: parsedError.errorMessage,
            } : null,
          });
          
          // Return error response
          resolve({
            success: false,
            details: errorMessage,
            filename,
          });
          return;
        }

        // Check BonOK for success file
        // File keeps .txt extension, just moved to BonOK directory
        const okFile = this.findResponseFile(bonOkPath, filename);
        if (okFile) {
          clearInterval(checkInterval);
          
          // Log success
          logger.info('ECR Bridge returned success', {
            filename,
            okFile,
            elapsed,
          });
          
          // Return success response
          resolve({
            success: true,
            filename,
          });
          return;
        }

        // No files found yet, continue polling
      }, pollInterval);
    });
  }
}

// Export singleton instance
export const ecrBridgeService = new ECRBridgeService();
export default ecrBridgeService;

