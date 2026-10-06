import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);

async function assertCommand(command, args, installHint) {
  try {
    await execFileAsync(command, args, { timeout: 90_000 });
  } catch (error) {
    const reason = error.code === 'ENOENT'
      ? 'not found on PATH'
      : error.killed
        ? 'timed out during startup verification'
        : 'could not be executed';
    throw new Error(`${command} is ${reason}. ${installHint}`);
  }
}

export async function verifyRuntimeDependencies() {
  const ytdlpPath = process.env.YTDLP_PATH || 'yt-dlp';
  const resolvedYtDlpPath = ytdlpPath.includes('/') || ytdlpPath.includes('\\')
    ? path.resolve(ytdlpPath)
    : ytdlpPath;
  await assertCommand(resolvedYtDlpPath, ['--version'], 'Install yt-dlp and set YTDLP_PATH if needed.');
  await assertCommand('ffmpeg', ['-version'], 'Install FFmpeg and make sure ffmpeg is on PATH.');
  await assertCommand('ffprobe', ['-version'], 'Install FFmpeg with ffprobe and make sure ffprobe is on PATH.');
}
