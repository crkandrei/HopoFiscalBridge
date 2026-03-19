/**
 * Tests for errorParser utility functions
 */

import { parseErrorFile, extractErrorMessage } from '../errorParser';

const exampleErrorContent = `I;Ora de joacă (2h);1;60;19; P;

-------------------------------------

Execution Log

-------------------------------------

11/13/2025 1:53:34 AM - ERROR: I can't read the serial number. `;

describe('parseErrorFile', () => {
  it('parses a standard ECR error file and extracts the error message', () => {
    const parsed = parseErrorFile(exampleErrorContent);
    expect(parsed.originalCommand).toBe('I;Ora de joacă (2h);1;60;19; P;');
    expect(parsed.errorMessage).toBe("I can't read the serial number.");
    expect(parsed.timestamp).toBeDefined();
    expect(parsed.rawContent).toBe(exampleErrorContent);
  });

  it('returns unknown error for empty content', () => {
    const parsed = parseErrorFile('');
    expect(parsed.errorMessage).toBe('Unknown error from ECR Bridge');
  });

  it('handles content without an execution log section', () => {
    const content = 'I;SomeProduct;1;50;19; P;\nSome error without log section';
    const parsed = parseErrorFile(content);
    expect(parsed.originalCommand).toBe('I;SomeProduct;1;50;19; P;');
    expect(parsed.errorMessage).toBeTruthy();
  });
});

describe('extractErrorMessage', () => {
  it('extracts the error message string from error file content', () => {
    const message = extractErrorMessage(exampleErrorContent);
    expect(message).toBe("I can't read the serial number.");
  });

  it('returns unknown error message for empty content', () => {
    const message = extractErrorMessage('');
    expect(message).toBe('Unknown error from ECR Bridge');
  });
});

export { exampleErrorContent };
