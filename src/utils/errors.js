export class AppError extends Error {
  constructor(message, statusCode = 500, code = 'APP_ERROR', details = undefined) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message, code = 'VALIDATION_ERROR') {
    super(message, 400, code);
  }
}

export class UnsupportedPlatformError extends AppError {
  constructor(message = 'Unsupported platform. Please use a public TikTok, Facebook, or YouTube URL.') {
    super(message, 400, 'UNSUPPORTED_PLATFORM');
  }
}

export class MediaDownloadError extends AppError {
  constructor(message, statusCode = 422, code = 'MEDIA_DOWNLOAD_FAILED') {
    super(message, statusCode, code);
  }
}

export function toPublicError(error) {
  if (error instanceof AppError) {
    return {
      success: false,
      error: error.message,
      code: error.code
    };
  }

  return {
    success: false,
    error: 'Something went wrong while processing this video.',
    code: 'INTERNAL_ERROR'
  };
}
