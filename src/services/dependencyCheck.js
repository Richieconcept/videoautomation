import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getYtDlpPath } from '../utils/ytdlpPath.js';

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
  await assertCommand(getYtDlpPath(), ['--version'], 'Install yt-dlp and set YTDLP_PATH if needed.');
  await assertCommand('ffmpeg', ['-version'], 'Install FFmpeg and make sure ffmpeg is on PATH.');
  await assertCommand('ffprobe', ['-version'], 'Install FFmpeg with ffprobe and make sure ffprobe is on PATH.');
}
