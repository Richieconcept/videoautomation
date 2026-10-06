import path from 'node:path';

export function getYtDlpPath() {
  const configuredPath = process.env.YTDLP_PATH || 'yt-dlp';
  const isWindowsExePath = /(^|[\\/])yt-dlp\.exe$/i.test(configuredPath);

  if (process.platform !== 'win32' && isWindowsExePath) {
    return 'yt-dlp';
  }

  return configuredPath.includes('/') || configuredPath.includes('\\')
    ? path.resolve(configuredPath)
    : configuredPath;
}
