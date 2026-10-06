import 'dotenv/config';
import app from './app.js';
import { verifyRuntimeDependencies } from './services/dependencyCheck.js';
import { ensureDownloadRoot } from './services/mediaStorage.js';
import { startSourceWatcherScheduler } from './services/sources/sourceWatcher.js';

const port = Number.parseInt(process.env.PORT || '3000', 10);

try {
  await ensureDownloadRoot();
  await verifyRuntimeDependencies();
  await startSourceWatcherScheduler();

  const server = app.listen(port, () => {
    console.log(`Social Video Fetcher running at http://localhost:${port}`);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. The app may already be running at http://localhost:${port}`);
      console.error('Close the other terminal running npm start, or stop the old node process before starting again.');
      process.exit(1);
    }

    throw error;
  });
} catch (error) {
  console.error('Startup dependency check failed:');
  console.error(error.message);
  process.exit(1);
}
