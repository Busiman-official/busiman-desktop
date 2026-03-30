import { app, BrowserWindow, Menu, Tray, nativeImage, dialog, ipcMain, powerMonitor, powerSaveBlocker, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';

// Auto attendance & proxy services
import { autoAttendanceService } from './services/auto-attendance.service';
import { autoCheckOutService } from './services/auto-checkout.service';
import { sessionService } from './services/session.service';
import { configService } from './services/config.service';
import { storageService } from './services/storage.service';
import { apiService } from './services/api.service';
import { proxyServerService } from './services/proxy-server.service';

// Network utilities
import { getCurrentNetwork, getCurrentWifi, NetworkInfo, WifiInfo } from './utils/network.util';

const execAsync = promisify(exec);
// Keep a global reference of the window object
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Optional: Disable hardware acceleration if GPU issues occur
// Set DISABLE_GPU=1 or ELECTRON_DISABLE_HW_ACCELERATION=1 environment variable to enable
if (process.env.DISABLE_GPU === '1' || process.env.ELECTRON_DISABLE_HW_ACCELERATION === '1') {
  app.disableHardwareAcceleration();
  console.log('[Main] Hardware acceleration disabled via environment variable');
}

// Windows-specific: Chromium occlusion fix for focus/input routing
// This must be called before app.whenReady()
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
}

// Suppress Electron/Chromium cache errors on Windows
// These are harmless permission warnings that can be safely ignored
if (process.platform === 'win32') {
  // Set a custom cache directory to avoid permission issues
  const cachePath = path.join(app.getPath('userData'), 'Cache');
  app.setPath('cache', cachePath);

  // Suppress console errors for cache issues (these are non-critical)
  const originalConsoleError = console.error;
  console.error = (...args: any[]) => {
    const message = args[0]?.toString() || '';
    // Filter out cache-related errors
    if (
      message.includes('cache_util_win.cc') ||
      message.includes('Unable to move the cache') ||
      message.includes('Unable to create cache') ||
      message.includes('Gpu Cache Creation failed')
    ) {
      // Silently ignore cache errors
      return;
    }
    originalConsoleError.apply(console, args);
  };
}

// Get the logo path
function getIconPath(): string | undefined {
  // Try multiple possible locations
  const possiblePaths = [
    // Development paths
    path.join(__dirname, '../../public/assets/logo.png'),
    path.join(process.cwd(), 'public/assets/logo.png'),
    // Production paths
    path.join(__dirname, '../assets/logo.png'),
    path.join(__dirname, '../../assets/logo.png'),
    // Packaged app paths
    path.join(process.resourcesPath, 'assets/logo.png'),
    path.join(app.getAppPath(), 'assets/logo.png'),
  ];

  // Find the first path that exists
  for (const iconPath of possiblePaths) {
    if (fs.existsSync(iconPath)) {
      return iconPath;
    }
  }

  return undefined;
}

function createWindow(): void {
  const iconPath = getIconPath();

  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false, // Don't show until ready-to-show to avoid blank window flash
    focusable: true, // Ensure window can receive focus
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true, // Keep security enabled
      devTools: isDev, // Only allow DevTools in development
      backgroundThrottling: false, // Prevent renderer from becoming inactive and losing input routing
    },
    titleBarStyle: 'default',
    autoHideMenuBar: true, // Hide the menu bar
    icon: iconPath, // Set window icon
  });

  // Remove the menu bar completely
  Menu.setApplicationMenu(null);

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    // In production, use loadURL with proper file:// path format
    const possiblePaths = [
      path.join(__dirname, '../dist/index.html'),
      path.join(__dirname, '../../dist/index.html'),
      path.join(process.resourcesPath, 'app/dist/index.html'),
      path.join(app.getAppPath(), 'dist/index.html'),
    ];

    let loaded = false;
    for (const htmlPath of possiblePaths) {
      if (fs.existsSync(htmlPath)) {
        // Convert to proper file:// URL format for Windows
        // C:\path\to\file -> file:///C:/path/to/file
        const normalizedPath = htmlPath.replace(/\\/g, '/');
        const fileUrl = `file:///${normalizedPath}`;

        mainWindow.loadURL(fileUrl);
        loaded = true;
        break;
      }
    }

    if (!loaded) {
      // Show user-friendly error message
      mainWindow.loadURL(`data:text/html,${encodeURIComponent(`
        <html>
          <head><title>Error</title></head>
          <body style="font-family: Arial; padding: 40px; text-align: center;">
            <h1>Application Error</h1>
            <p>Could not load the application files.</p>
            <p>Please reinstall the application.</p>
          </body>
        </html>
      `)}`);
    }

    // Handle errors silently in production
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      // Only log critical errors
      if (errorCode !== -3) { // -3 is ERR_ABORTED, which is normal for some navigations
        console.error('Failed to load page:', errorDescription);
      }
    });
  }

  // Open DevTools on startup only in development
  if (isDev) {
  mainWindow.webContents.openDevTools();
  }

  // Handle ready-to-show: show window only when content is ready (prevents blank window flash)
  // Do NOT send window:focus-recovery here - only on explicit recovery triggers
  mainWindow.once('ready-to-show', () => {
    // If --hidden flag is set (for auto-start), keep window hidden
    if (!process.argv.includes('--hidden')) {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.focus();
        // Do NOT send 'window:focus-recovery' here - this is normal window creation, not recovery
      }
    }
  });

  // Handle window show event: OS handles show events correctly, no recovery needed
  mainWindow.on('show', () => {
    // Do nothing - OS handles show events correctly
    // We do not treat show as a trigger for focus recovery
  });

  // Handle window focus event: passive webContents focus only, no recovery signal
  mainWindow.on('focus', () => {
    // Passive webContents focus only - normal focus events should not drive "repair"
    // Repair is for broken states, not normal OS focus events
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.focus();
      // Do NOT send 'window:focus-recovery' here - this is normal focus, not recovery
    }
  });

  // Handle window blur event: track that we lost focus (for diagnostics)
  mainWindow.on('blur', () => {
    // No logic needed - optional: set a "hadFocus" flag for diagnostics only
  });

  // Handle window close - hide to tray instead of closing
  mainWindow.on('close', (event) => {
    if (!appIsQuitting && !isCheckingOut) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  // Set main window reference in session service for IPC communication
  sessionService.setMainWindow(mainWindow);

  // Emitted when the window is actually closed
  mainWindow.on('closed', () => {
    sessionService.setMainWindow(null);
    mainWindow = null;
  });
}

// Create system tray
function createTray(): void {
  const iconPath = getIconPath();

  if (!iconPath) {
    return; // Can't create tray without icon
  }

  // Create tray icon
  const trayIcon = nativeImage.createFromPath(iconPath);
  tray = new Tray(trayIcon.resize({ width: 16, height: 16 }));

  // Create context menu
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Busiman Desktop',
      click: () => {
        if (mainWindow) {
          runNonVisualFocusRecovery();
        } else {
          createWindow();
        }
      },
    },
    {
      type: 'separator',
    },
    {
      label: 'View System Logs',
      click: () => {
        if (mainWindow) {
          runNonVisualFocusRecovery();
          // Send IPC message to open logs viewer
          setImmediate(() => {
            mainWindow?.webContents?.send('open-logs-viewer');
          });
        } else {
          createWindow();
          // Wait for window to load, then send message
          setTimeout(() => {
            if (mainWindow) {
              mainWindow.webContents.send('open-logs-viewer');
            }
          }, 1000);
        }
      },
    },
    {
      type: 'separator',
    },
    {
      label: 'Quit',
      click: () => {
        appIsQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip('Busiman Desktop');
  tray.setContextMenu(contextMenu);

  // Double-click to show window
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });

  // Single click to toggle (Windows)
  if (process.platform === 'win32') {
    tray.on('click', () => {
      if (mainWindow) {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          runNonVisualFocusRecovery();
        }
      } else {
        createWindow();
      }
    });
  }
}

// Helper function to refocus window after native dialogs
// Non-visual focus recovery: show, setFocusable, focus, webContents.focus, signal renderer
// Never use moveTop() or setAlwaysOnTop() - these cause window switching animations
function refocusWindowAfterDialog(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.show(); // only has effect if hidden/minimized
  mainWindow.setFocusable(true);
  mainWindow.focus();
  mainWindow.webContents.focus();
  mainWindow.webContents.send('window:focus-recovery');
}

// Shared helper for non-visual focus recovery (used by tray, second-instance, activate, IPC)
function runNonVisualFocusRecovery(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.show(); // only has effect if hidden/minimized
  mainWindow.setFocusable(true);
  mainWindow.focus();
  mainWindow.webContents.focus();
  mainWindow.webContents.send('window:focus-recovery');
}

// Disable hardware acceleration if causing issues (uncomment if needed)
// app.disableHardwareAcceleration();

// Prevent app from quitting when all windows are closed
let appIsQuitting = false;
let isCheckingOut = false;
let shutdownEventPrevented = false;
let sleepBlockerId: number | null = null;

// Setup auto-start configuration
function setupAutoStart(): void {
  try {
    const autoStartEnabled = configService.isAutoStartEnabled();

    app.setLoginItemSettings({
      openAtLogin: autoStartEnabled,
      openAsHidden: true, // Start minimized to tray
      name: 'Busiman Desktop',
      args: ['--hidden'], // Hidden flag for startup
    });
  } catch (error) {
    console.error('[AutoStart] Failed to configure auto-start:', error);
  }
}

// Setup auto attendance system
function setupAutoAttendance(): void {
  // Note: App start auto check-in is now handled via IPC after auth initialization
  // This is triggered from the renderer process after initializeAuth completes
  // This ensures the window is ready and auth state is properly loaded

  // 2. System wake detection
  if (powerMonitor) {
    powerMonitor.on('resume', () => {

      // Wait 5 seconds for network to reconnect
      setTimeout(() => {
        autoAttendanceService.attemptAutoCheckIn('system_wake').catch((error) => {
          console.error('[AutoAttendance] System wake check-in failed:', error);
        });
      }, 5000);
    });
  }

  // 3. Network change detection (polling)
  let lastNetworkState: string | null = null;
  let networkChangeDebounceTimer: NodeJS.Timeout | null = null;

  const checkNetworkChange = async () => {
    try {
      const networkInfo = await getCurrentNetwork();
      const currentState = JSON.stringify({
        type: networkInfo.type,
        ssid: networkInfo.wifi?.ssid,
        bssid: networkInfo.wifi?.bssid,
        macAddress: networkInfo.ethernet?.macAddress,
      });

      if (lastNetworkState !== null && lastNetworkState !== currentState) {


        // Debounce network change (wait 3 seconds for connection to stabilize)
        if (networkChangeDebounceTimer) {
          clearTimeout(networkChangeDebounceTimer);
        }

        networkChangeDebounceTimer = setTimeout(() => {
          autoAttendanceService.attemptAutoCheckIn('network_change').catch((error) => {
            console.error('[AutoAttendance] Network change check-in failed:', error);
          });
        }, 3000);
      }

      lastNetworkState = currentState;
    } catch (error) {
      console.error('[AutoAttendance] Network change detection error:', error);
    }
  };

  // Poll network every 5 seconds
  setInterval(checkNetworkChange, 5000);

  // Initial network state check
  checkNetworkChange();
}

// Setup auto check-out on shutdown/logout
function setupAutoCheckout(): void {
  // Check for recovery on app start
  checkRecoveryCheckout();

  // Setup shutdown/logout/sleep detection
  if (powerMonitor) {
    // Windows shutdown detection
    if (process.platform === 'win32') {
      powerMonitor.on('shutdown', async () => {
        console.log('[AutoCheckout] System shutdown detected');
        await handleShutdownEvent({}, 'shutdown');
      });
    }

    // System sleep/suspend detection (works on all platforms)
    powerMonitor.on('suspend', async () => {
      console.log('[AutoCheckout] System sleep/suspend detected');
      // Note: We can't prevent sleep, but we can attempt check-out quickly
      await handleSleepEvent();
    });

    // System lock detection (Windows/macOS)
    if (process.platform === 'win32' || process.platform === 'darwin') {
      powerMonitor.on('lock-screen', async () => {
        console.log('[AutoCheckout] Screen lock detected');
        // Handle lock screen - show dialog asking if user wants to check out
        await handleShutdownEvent({}, 'logout');
      });
    }
  }

  // Handle app termination (may indicate logout)
  app.on('before-quit', async (event) => {
    if (!appIsQuitting && !isCheckingOut) {
      console.log('[AutoCheckout] App quit detected (possible logout)');
      await handleShutdownEvent(event, 'logout');
    }
  });

  // Handle window close (may indicate logout on some systems)
  app.on('will-quit', async (event) => {
    if (!appIsQuitting && !isCheckingOut && !shutdownEventPrevented) {
      console.log('[AutoCheckout] Will quit event detected');
      await handleShutdownEvent(event, 'logout');
    }
  });
}

// Handle sleep event - BLOCK sleep until user responds
async function handleSleepEvent(): Promise<void> {
  // Check if feature is enabled
  if (!configService.isAutoCheckoutOnShutdownEnabled()) {
    console.log('[AutoCheckout] Auto check-out on sleep is disabled');
    return;
  }

  // Check if already checking out
  if (isCheckingOut) {
    console.log('[AutoCheckout] Check-out already in progress');
    return;
  }

  // BLOCK SLEEP - Start power save blocker to prevent system from sleeping
  try {
    sleepBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    console.log('[AutoCheckout] Sleep blocked - waiting for user response');
  } catch (error) {
    console.error('[AutoCheckout] Failed to block sleep:', error);
  }

  // Check authentication
  const isAuthenticated = await sessionService.isAuthenticated();
  if (!isAuthenticated) {
    console.log('[AutoCheckout] User not authenticated, skipping check-out');
    stopSleepBlocker();
    return;
  }

  // Check attendance status
  try {
    const status = await apiService.getAttendanceStatus();
    
    if (status.status === 'NOT_STARTED') {
      console.log('[AutoCheckout] User not checked in, skipping check-out');
      stopSleepBlocker();
      return;
    }

    if (status.status === 'CHECKED_OUT') {
      console.log('[AutoCheckout] User already checked out, skipping check-out');
      stopSleepBlocker();
      return;
    }

    // User is checked in - show dialog (sleep is blocked, so dialog will be visible)
    await showCheckoutDialogForSleep();
  } catch (error: any) {
    console.error('[AutoCheckout] Failed to check attendance status during sleep:', error);
    stopSleepBlocker();
  }
}

// Stop sleep blocker
function stopSleepBlocker(): void {
  if (sleepBlockerId !== null) {
    try {
      powerSaveBlocker.stop(sleepBlockerId);
      sleepBlockerId = null;
      console.log('[AutoCheckout] Sleep blocker stopped');
    } catch (error) {
      console.error('[AutoCheckout] Failed to stop sleep blocker:', error);
    }
  }
}

// Show check-out dialog for sleep (sleep is BLOCKED, so dialog will be visible)
async function showCheckoutDialogForSleep(): Promise<void> {
  // Ensure window is visible and focused
  if (mainWindow) {
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
    mainWindow.focus();
    // Do NOT use moveTop() - causes window switching animation
  }

  try {
    const dialogOptions: Electron.MessageBoxOptions = {
      type: 'question',
      title: 'Check Out',
      message: 'Are you checking out...?',
      detail: 'Your system is trying to sleep. Would you like to check out before sleeping?',
      buttons: ['Check Out', 'Continue'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    };
    
    // Show dialog - sleep is blocked, so this will be visible and block until user responds
    const dialogResult = mainWindow
      ? await dialog.showMessageBox(mainWindow, dialogOptions)
      : await dialog.showMessageBox(dialogOptions);

    // Refocus window after dialog closes
    refocusWindowAfterDialog();

    if (dialogResult.response === 0) {
      // User selected "Check Out"
      await performCheckoutOnSleep();
    } else {
      // User selected "Continue" - save timestamp and allow sleep
      console.log('[AutoCheckout] User chose to continue without check-out');
      
      // Save timestamp when user closes without checking out
      const sessionState = storageService.getLastSessionState();
      storageService.saveSessionState({
        ...sessionState,
        pendingCheckout: true,
        sessionEndTimestamp: new Date(),
      });
      storageService.markSessionEnd(new Date());
      
      stopSleepBlocker();
    }
  } catch (error) {
    console.error('[AutoCheckout] Dialog error during sleep:', error);
    // On error, stop blocker and allow sleep
    stopSleepBlocker();
    // Refocus window even on error
    refocusWindowAfterDialog();
  }
}

// Perform check-out on sleep (sleep is still blocked until this completes)
async function performCheckoutOnSleep(): Promise<void> {
  isCheckingOut = true;
  const timeout = configService.getCheckoutTimeout() * 1000; // Use configured timeout

  try {
    console.log('[AutoCheckout] Attempting check-out (sleep is blocked)');

    // Create timeout promise
    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        console.warn('[AutoCheckout] Check-out timeout');
        resolve();
      }, timeout);
    });

    // Create check-out promise (use fast mode for sleep)
    const checkoutPromise = autoCheckOutService.attemptCheckout('shutdown', true);

    // Race between check-out and timeout
    const result = await Promise.race([
      checkoutPromise.then(() => ({ success: true })),
      timeoutPromise.then(() => ({ success: false, reason: 'Timeout' })),
    ]);

    if (result.success) {
      const checkoutResult = await checkoutPromise;
      if (checkoutResult.success) {
        console.log('[AutoCheckout] Check-out successful');
        // Clear pending checkout state (check-out completed successfully)
        const sessionState = storageService.getLastSessionState();
        if (sessionState) {
          storageService.saveSessionState({ ...sessionState, pendingCheckout: false });
        }
      } else {
        // Check if error is due to already checked out or invalid status
        const isStatusError = checkoutResult.errorCode === 'ALREADY_CHECKED_OUT' || 
                              checkoutResult.errorCode === 'INVALID_STATUS' ||
                              checkoutResult.reason?.includes('already checked out') ||
                              checkoutResult.reason?.includes('current attendance status');
        
        if (isStatusError) {
          console.log(`[AutoCheckout] Check-out not needed before sleep: ${checkoutResult.reason}`);
          // User is already checked out - clear pending state
          const sessionState = storageService.getLastSessionState();
          if (sessionState) {
            storageService.saveSessionState({ ...sessionState, pendingCheckout: false });
          }
        } else {
          console.error(`[AutoCheckout] Check-out failed before sleep: ${checkoutResult.reason}`);
          // Store pending checkout state only if it's a real error
          const sessionState = storageService.getLastSessionState();
          storageService.saveSessionState({
            ...sessionState,
            pendingCheckout: true,
            sessionEndTimestamp: new Date(),
          });
        }
      }
    } else {
      console.warn('[AutoCheckout] Check-out timed out');
      // Store pending checkout state
      const sessionState = storageService.getLastSessionState();
      storageService.saveSessionState({
        ...sessionState,
        pendingCheckout: true,
        sessionEndTimestamp: new Date(),
      });
    }
  } catch (error: any) {
    console.error('[AutoCheckout] Check-out error:', error);
    // Store pending checkout state
    const sessionState = storageService.getLastSessionState();
    storageService.saveSessionState({
      ...sessionState,
      pendingCheckout: true,
      sessionEndTimestamp: new Date(),
    });
  } finally {
    isCheckingOut = false;
    // STOP SLEEP BLOCKER - Allow sleep to proceed after check-out completes
    stopSleepBlocker();
  }
}

// Handle shutdown/logout event
async function handleShutdownEvent(
  event: Electron.Event | { preventDefault?: () => void },
  trigger: 'shutdown' | 'logout'
): Promise<void> {
  // Prevent default shutdown behavior
  if (event && typeof (event as any).preventDefault === 'function') {
    (event as any).preventDefault();
    shutdownEventPrevented = true;
  }

  // Check if feature is enabled
  if (!configService.isAutoCheckoutOnShutdownEnabled()) {
    console.log('[AutoCheckout] Auto check-out on shutdown is disabled');
    allowShutdown();
    return;
  }

  // Check if already checking out
  if (isCheckingOut) {
    console.log('[AutoCheckout] Check-out already in progress');
    return;
  }

  // Check authentication
  const isAuthenticated = await sessionService.isAuthenticated();
  if (!isAuthenticated) {
    console.log('[AutoCheckout] User not authenticated, skipping check-out');
    allowShutdown();
    return;
  }

  // Check attendance status
  try {
    const status = await apiService.getAttendanceStatus();
    
    if (status.status === 'NOT_STARTED') {
      console.log('[AutoCheckout] User not checked in, skipping check-out');
      allowShutdown();
      return;
    }

    if (status.status === 'CHECKED_OUT') {
      console.log('[AutoCheckout] User already checked out, skipping check-out');
      allowShutdown();
      return;
    }

    // User is checked in - SAVE PENDING STATE FIRST (safety mechanism)
    // This ensures state is saved even if dialog doesn't show or system forces shutdown
    const shutdownTimestamp = new Date();
    const sessionState = storageService.getLastSessionState();
    storageService.saveSessionState({
      ...sessionState,
      pendingCheckout: true,
      sessionEndTimestamp: shutdownTimestamp,
    });
    storageService.markSessionEnd(shutdownTimestamp);
    console.log('[AutoCheckout] Saved pending checkout state with timestamp:', shutdownTimestamp.toISOString());

    // Now show dialog
    await showCheckoutDialog(trigger);
  } catch (error: any) {
    console.error('[AutoCheckout] Failed to check attendance status:', error);
    // On error, save pending state anyway (user might be checked in)
    try {
      const shutdownTimestamp = new Date();
      const sessionState = storageService.getLastSessionState();
      storageService.saveSessionState({
        ...sessionState,
        pendingCheckout: true,
        sessionEndTimestamp: shutdownTimestamp,
      });
      storageService.markSessionEnd(shutdownTimestamp);
      console.log('[AutoCheckout] Saved pending checkout state (error case)');
    } catch (saveError) {
      console.error('[AutoCheckout] Failed to save pending state:', saveError);
    }
    // On error, allow shutdown to proceed
    allowShutdown();
  }
}

// Show check-out dialog
async function showCheckoutDialog(trigger: 'shutdown' | 'logout'): Promise<void> {
  // Ensure window is visible
  if (mainWindow && !mainWindow.isVisible()) {
    mainWindow.show();
    mainWindow.focus();
  }

  try {
    const dialogOptions: Electron.MessageBoxOptions = {
      type: 'question',
      title: 'Check Out',
      message: 'Are you checking out...?',
      detail: 'You are currently checked in. Would you like to check out before shutting down?',
      buttons: ['Check Out', 'Continue Anyway'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    };
    
    const dialogResult = mainWindow
      ? await dialog.showMessageBox(mainWindow, dialogOptions)
      : await dialog.showMessageBox(dialogOptions);

    // Refocus window after dialog closes
    refocusWindowAfterDialog();

    if (dialogResult.response === 0) {
      // User selected "Check Out"
      await performCheckoutOnShutdown(trigger);
    } else {
      // User selected "Continue Anyway"
      console.log('[AutoCheckout] User chose to continue without check-out');
      // State already saved in handleShutdownEvent, just allow shutdown
      allowShutdown();
    }
  } catch (error) {
    console.error('[AutoCheckout] Dialog error:', error);
    // On error, allow shutdown
    allowShutdown();
    // Refocus window even on error
    refocusWindowAfterDialog();
  }
}

// Perform check-out on shutdown
async function performCheckoutOnShutdown(trigger: 'shutdown' | 'logout'): Promise<void> {
  isCheckingOut = true;
  const timeout = configService.getCheckoutTimeout() * 1000; // Convert to milliseconds
  const useFastMode = trigger === 'shutdown'; // Use fast mode for shutdown

  try {
    console.log(`[AutoCheckout] Attempting check-out (trigger: ${trigger}, fastMode: ${useFastMode})`);

    // Create timeout promise
    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        console.warn(`[AutoCheckout] Check-out timeout after ${timeout}ms`);
        resolve();
      }, timeout);
    });

    // Create check-out promise
    const checkoutPromise = autoCheckOutService.attemptCheckout(trigger, useFastMode);

    // Race between check-out and timeout
    const result = await Promise.race([
      checkoutPromise.then(() => ({ success: true })),
      timeoutPromise.then(() => ({ success: false, reason: 'Timeout' })),
    ]);

    if (result.success) {
      const checkoutResult = await checkoutPromise;
      if (checkoutResult.success) {
        console.log('[AutoCheckout] Check-out successful');
        // Clear pending checkout state (check-out completed successfully)
        const sessionState = storageService.getLastSessionState();
        if (sessionState) {
          storageService.saveSessionState({ ...sessionState, pendingCheckout: false });
        }
      } else {
        // Check if error is due to already checked out or invalid status
        const isStatusError = checkoutResult.errorCode === 'ALREADY_CHECKED_OUT' || 
                              checkoutResult.errorCode === 'INVALID_STATUS' ||
                              checkoutResult.reason?.includes('already checked out') ||
                              checkoutResult.reason?.includes('current attendance status');
        
        if (isStatusError) {
          console.log(`[AutoCheckout] Check-out not needed: ${checkoutResult.reason}`);
          // User is already checked out or in invalid status - clear pending state
          const sessionState = storageService.getLastSessionState();
          if (sessionState) {
            storageService.saveSessionState({ ...sessionState, pendingCheckout: false });
          }
        } else {
          console.error(`[AutoCheckout] Check-out failed: ${checkoutResult.reason}`);
          // Show error but allow shutdown
          if (mainWindow) {
            await dialog.showMessageBox(mainWindow, {
              type: 'warning',
              title: 'Check-out Failed',
              message: `Check-out failed: ${checkoutResult.reason}`,
              detail: 'The system will shut down anyway. You may need to manually check out later.',
              buttons: ['OK'],
            });
            // Refocus window after dialog closes
            refocusWindowAfterDialog();
          }
          // Store pending checkout state only if it's a real error
          const sessionState = storageService.getLastSessionState();
          storageService.saveSessionState({
            ...sessionState,
            pendingCheckout: true,
            sessionEndTimestamp: new Date(),
          });
        }
      }
    } else {
      console.warn('[AutoCheckout] Check-out timed out, allowing shutdown');
      // Store pending checkout state
      const sessionState = storageService.getLastSessionState();
      storageService.saveSessionState({
        ...sessionState,
        pendingCheckout: true,
        sessionEndTimestamp: new Date(),
      });
    }
  } catch (error: any) {
    console.error('[AutoCheckout] Check-out error:', error);
    // Store pending checkout state
    const sessionState = storageService.getLastSessionState();
    storageService.saveSessionState({
      ...sessionState,
      pendingCheckout: true,
      sessionEndTimestamp: new Date(),
    });
  } finally {
    isCheckingOut = false;
    allowShutdown();
  }
}

// Allow shutdown to proceed
function allowShutdown(): void {
  if (shutdownEventPrevented) {
    shutdownEventPrevented = false;
    appIsQuitting = true;
    app.quit();
  }
}

// Check for recovery check-out on app start - show dialog asking user
async function checkRecoveryCheckout(): Promise<void> {
  try {
    const sessionState = storageService.getLastSessionState();
    if (!sessionState) {
      return;
    }

    // Check if there's a pending check-out
    if (sessionState.pendingCheckout && sessionState.sessionEndTimestamp) {
      console.log('[AutoCheckout] Found pending check-out from previous session');
      
      // Wait a bit for app to fully initialize
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Check if user is authenticated
      const isAuthenticated = await sessionService.isAuthenticated();
      if (!isAuthenticated) {
        console.log('[AutoCheckout] User not authenticated, skipping recovery');
        return;
      }

      // Check current attendance status
      try {
        const status = await apiService.getAttendanceStatus();
        
        // If still checked in, show dialog asking user
        if (status.status === 'CHECKED_IN') {
          // Format the shutdown time
          const shutdownTime = new Date(sessionState.sessionEndTimestamp);
          const timeString = shutdownTime.toLocaleString();
          
          // Ensure window is visible
          if (mainWindow) {
            if (!mainWindow.isVisible()) {
              mainWindow.show();
            }
            mainWindow.setFocusable(true);
            mainWindow.focus();
            mainWindow.webContents.focus();
            // Do NOT use moveTop() - causes window switching animation
          }

          // Show dialog asking user if they want to check out
          const dialogOptions: Electron.MessageBoxOptions = {
            type: 'question',
            title: 'Previous Session Check-out',
            message: 'Do you want to check out?',
            detail: `You closed the system at ${timeString} without checking out. Would you like to check out now at that time?`,
            buttons: ['Check Out', 'Skip'],
            defaultId: 0,
            cancelId: 1,
            noLink: true,
          };
          
          const dialogResult = mainWindow
            ? await dialog.showMessageBox(mainWindow, dialogOptions)
            : await dialog.showMessageBox(dialogOptions);

          // Refocus window after dialog closes
          refocusWindowAfterDialog();

          if (dialogResult.response === 0) {
            // User selected "Check Out"
            console.log('[AutoCheckout] User chose to check out from previous session');
            
            let networkInfo: NetworkInfo | undefined;
            if (sessionState.lastNetworkInfo) {
              if (sessionState.lastNetworkInfo.type === 'wifi') {
                networkInfo = {
                  type: 'wifi',
                  wifi: {
                    ssid: sessionState.lastNetworkInfo.ssid || '',
                    bssid: sessionState.lastNetworkInfo.bssid || null,
                  },
                };
              } else if (sessionState.lastNetworkInfo.type === 'ethernet') {
                networkInfo = {
                  type: 'ethernet',
                  ethernet: {
                    macAddress: sessionState.lastNetworkInfo.macAddress || '',
                  },
                };
              }
            }

            // Use the saved shutdown time for check-out, not current time
            const checkOutTime = new Date(sessionState.sessionEndTimestamp);
            console.log(`[AutoCheckout] Checking out at saved time: ${checkOutTime.toISOString()}`);
            
            const result = await autoCheckOutService.attemptCheckout('recovery', false, networkInfo, checkOutTime);
            
            if (result.success) {
              console.log('[AutoCheckout] Recovery check-out successful');
              // Clear pending state
              storageService.saveSessionState({
                ...sessionState,
                pendingCheckout: false,
              });
            } else {
              console.error(`[AutoCheckout] Recovery check-out failed: ${result.reason}`);
              // Show error to user
              if (mainWindow) {
                await dialog.showMessageBox(mainWindow, {
                  type: 'error',
                  title: 'Check-out Failed',
                  message: `Check-out failed: ${result.reason}`,
                  buttons: ['OK'],
                });
                // Refocus window after dialog closes
                refocusWindowAfterDialog();
              }
            }
          } else {
            // User selected "Skip"
            console.log('[AutoCheckout] User chose to skip recovery check-out');
            // Clear pending state since user explicitly skipped
            storageService.saveSessionState({
              ...sessionState,
              pendingCheckout: false,
            });
          }
        } else if (status.status === 'CHECKED_OUT') {
          // Already checked out, clear pending state
          console.log('[AutoCheckout] Already checked out, clearing pending state');
          storageService.saveSessionState({
            ...sessionState,
            pendingCheckout: false,
          });
        }
      } catch (error: any) {
        console.error('[AutoCheckout] Failed to check attendance status during recovery:', error);
      }
    }
  } catch (error: any) {
    console.error('[AutoCheckout] Recovery check-out error:', error);
  }
}


// Function to check for updates (ensures window is ready)
function checkForUpdates(): void {
  if (isDev) {
    console.log('[AutoUpdater] Skipping update check in development mode');
    return;
  }

  if (!mainWindow) {
    console.log('[AutoUpdater] Window not ready, will check after window is created');
    return;
  }

  console.log('[AutoUpdater] Checking for updates...');
  autoUpdater.checkForUpdates().catch((error) => {
    console.error('[AutoUpdater] Error checking for updates:', error);
  });
}

// Configure auto-updater
function setupAutoUpdater(): void {
  // Disable auto-download (we'll handle it manually)
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // GitHub provider is automatically configured from package.json
  // No need to setFeedURL when using GitHub provider
  // electron-updater will automatically detect GitHub releases

  // Handle update available
  autoUpdater.on('update-available', (info) => {
    console.log('[AutoUpdater] Update available:', info.version);
    
    // Ensure window exists and is visible
    if (!mainWindow) {
      console.warn('[AutoUpdater] Window not available, cannot show update dialog');
      return;
    }

    // Show and focus window if it's hidden or minimized
    if (!mainWindow.isVisible() || mainWindow.isMinimized()) {
      mainWindow.show();
      mainWindow.restore();
    }
    mainWindow.setFocusable(true);
    mainWindow.focus();
    mainWindow.webContents.focus();
    // Do NOT use moveTop() - causes window switching animation

    dialog
      .showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Available',
        message: `A new version (${info.version}) is available.`,
        detail: 'Would you like to download and install it now?',
        buttons: ['Download Now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
      .then((result) => {
        // Refocus window after dialog closes
        refocusWindowAfterDialog();
        if (result.response === 0) {
          console.log('[AutoUpdater] User chose to download update');
          autoUpdater.downloadUpdate();
        } else {
          console.log('[AutoUpdater] User chose to download later');
        }
      })
      .catch((error) => {
        console.error('[AutoUpdater] Error showing update dialog:', error);
        // Refocus window even on error
        refocusWindowAfterDialog();
      });
  });

  // Handle update downloaded
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[AutoUpdater] Update downloaded:', info.version);
    
    // Ensure window exists and is visible
    if (!mainWindow) {
      console.warn('[AutoUpdater] Window not available, cannot show update ready dialog');
      return;
    }

    // Show and focus window if it's hidden or minimized
    if (!mainWindow.isVisible() || mainWindow.isMinimized()) {
      mainWindow.show();
      mainWindow.restore();
    }
    mainWindow.setFocusable(true);
    mainWindow.focus();
    mainWindow.webContents.focus();
    // Do NOT use moveTop() - causes window switching animation

    dialog
      .showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update Ready',
        message: 'Update downloaded. The application will restart to install the update.',
        detail: `Version ${info.version} is ready to install.`,
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
      .then((result) => {
        // Refocus window after dialog closes
        refocusWindowAfterDialog();
        if (result.response === 0) {
          console.log('[AutoUpdater] User chose to restart now');
          autoUpdater.quitAndInstall(false, true);
        } else {
          console.log('[AutoUpdater] User chose to restart later');
        }
      })
      .catch((error) => {
        console.error('[AutoUpdater] Error showing update ready dialog:', error);
        // Refocus window even on error
        refocusWindowAfterDialog();
      });
  });

  // Handle update not available
  autoUpdater.on('update-not-available', (info) => {
    console.log('[AutoUpdater] No update available. Current version:', info.version);
  });

  // Handle update check started
  autoUpdater.on('checking-for-update', () => {
    console.log('[AutoUpdater] Checking for updates...');
  });

  // Handle update errors (log in production for debugging)
  autoUpdater.on('error', (error) => {
    console.error('[AutoUpdater] Error:', error.message || error);
  });
}

// Prevent multiple instances of the app
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is already running, quit this one
  app.quit();
} else {
  // Handle when a second instance is attempted
  app.on('second-instance', () => {
    // Someone tried to run a second instance, focus our window instead
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      runNonVisualFocusRecovery();
    } else {
      // Window was destroyed, create a new one
      createWindow();
    }
  });

  // This method will be called when Electron has finished initialization
  app.whenReady().then(() => {
    // Set app icon after app is ready
    const iconPath = getIconPath();
    if (iconPath) {
      // Set dock icon for macOS
      if (process.platform === 'darwin' && app.dock) {
        app.dock.setIcon(iconPath);
      }

      // Set app user model ID for Windows (helps with taskbar icon)
      if (process.platform === 'win32') {
        app.setAppUserModelId('com.busiman.desktop');
      }
    }

    // Setup auto-updater
    setupAutoUpdater();

    // Setup auto-start
    setupAutoStart();

    // Setup auto attendance system
    setupAutoAttendance();

    // Setup auto check-out on shutdown/logout
    setupAutoCheckout();

    // Create system tray first
    createTray();

  // Create main window
  createWindow();

  // Set main window reference for session service
  sessionService.setMainWindow(mainWindow);

  // Wait for window to be ready before checking for updates
  if (mainWindow && !isDev) {
    mainWindow.webContents.once('did-finish-load', () => {
      console.log('[AutoUpdater] Window loaded, checking for updates in 3 seconds...');
      // Wait a bit more for window to be fully ready, then check for updates
      setTimeout(() => {
        checkForUpdates();
      }, 3000); // Wait 3 seconds after window loads

      // Then check periodically (every 4 hours)
      setInterval(() => {
        checkForUpdates();
      }, 4 * 60 * 60 * 1000); // 4 hours
    });
  }

    app.on('activate', () => {
      // On macOS, re-create window when dock icon is clicked
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
        sessionService.setMainWindow(mainWindow);
      } else if (mainWindow) {
        if (mainWindow.isMinimized()) {
          mainWindow.restore();
        }
        runNonVisualFocusRecovery();
      }
    });
  });
}

// Network detection functions are now in utils/network.util.ts
// Keeping IPC handlers here for backward compatibility

/**
 * Get MAC address of Ethernet adapter (deprecated - use network.util)
 * @deprecated Use getEthernetMacAddress from utils/network.util
 */
async function getEthernetMacAddress(): Promise<{ macAddress: string | null; adapterName?: string }> {
  const platform = process.platform;
  console.log(`[DEBUG] getEthernetMacAddress() called on platform: ${platform}`);

  try {
    if (platform === 'win32') {

      // Windows: Use getmac command and ipconfig to find active Ethernet adapters
      try {
        // Method 1: Use ipconfig /all to find active adapters with IP addresses (most reliable)

        const { stdout: ipconfigOutput } = await execAsync('ipconfig /all');

        const ipconfigLines = ipconfigOutput.split(/\r?\n/);


        let currentAdapter = '';
        let currentMac = '';
        let hasIpAddress = false;
        const activeAdapters: Array<{ name: string; mac: string }> = [];

        for (let i = 0; i < ipconfigLines.length; i++) {
          const line = ipconfigLines[i].trim();

          // Check for adapter name (ends with : and doesn't start with space, not an IP line)
          if (line && line.endsWith(':') && !line.startsWith(' ') && !line.match(/^\d+\./)) {
            // Save previous adapter if it had MAC (even without IP, as USB adapters might show "Media disconnected" but still work)
            if (currentAdapter && currentMac) {
              // Only check if it's not WiFi
              if (!/wireless|wlan|wi-fi|802\.11|wifi|qualcomm.*wireless|qca.*wireless/i.test(currentAdapter)) {
                // Skip loopback/virtual but keep USB Ethernet and all Ethernet adapters
                if (!/loopback|tunneling|isatap|teredo|6to4|vmware.*adapter|virtualbox.*adapter|hyper-v.*virtual|microsoft.*wifi.*direct|bluetooth/i.test(currentAdapter)) {
                  // Prefer adapters with IP, but also include those without (for USB Ethernet that might show "Media disconnected")
                  if (hasIpAddress) {
                    activeAdapters.unshift({ name: currentAdapter, mac: currentMac }); // Put at front
                  } else {
                    activeAdapters.push({ name: currentAdapter, mac: currentMac }); // Put at back
                  }
                }
              }
            }
            // Reset for new adapter
            currentAdapter = line.replace(/:$/, '').trim();
            currentMac = '';
            hasIpAddress = false;
          }

          // Look for Physical Address
          if (line.includes('Physical Address') || line.includes('Physical address')) {
            const macMatch = line.match(/([0-9A-F]{2}[:-]){5}([0-9A-F]{2})/i);
            if (macMatch && currentAdapter) {
              currentMac = macMatch[0].replace(/-/g, ':').toUpperCase();

            }
          }

          // Check for IPv4 Address (indicates active connection)
          // Match IPv4 Address lines, but exclude Autoconfiguration ones
          if (line.includes('IPv4 Address') && !line.includes('Autoconfiguration')) {
            // Extract IP address, handling (Preferred) suffix
            const ipMatch = line.match(/IPv4 Address[^:]*:\s*(\d+\.\d+\.\d+\.\d+)(?:\(Preferred\))?/i);
            if (ipMatch && ipMatch[1] !== '0.0.0.0') {
              hasIpAddress = true;

            }
          }
        }

        // Save last adapter if it had MAC
        if (currentAdapter && currentMac) {
          if (!/wireless|wlan|wi-fi|802\.11|wifi|qualcomm.*wireless|qca.*wireless/i.test(currentAdapter)) {
            if (!/loopback|tunneling|isatap|teredo|6to4|vmware.*adapter|virtualbox.*adapter|hyper-v.*virtual|microsoft.*wifi.*direct|bluetooth/i.test(currentAdapter)) {
              if (hasIpAddress) {
                activeAdapters.unshift({ name: currentAdapter, mac: currentMac });
              } else {
                activeAdapters.push({ name: currentAdapter, mac: currentMac });
              }
            }
          }
        }

        // Return first adapter (prioritizes those with IP addresses)
        console.log(`[DEBUG] Found ${activeAdapters.length} Ethernet adapter(s):`, activeAdapters.map(a => `${a.name} (${a.mac})`).join(', '));
        if (activeAdapters.length > 0) {
          const adapter = activeAdapters[0];
          console.log(`[DEBUG] ✓ Selected Ethernet adapter: ${adapter.name} (${adapter.mac})`);
          return { macAddress: adapter.mac, adapterName: adapter.name };
        }

        // Fallback: Try getmac as backup (for adapters not showing in ipconfig)

        try {
          const { stdout: getmacOutput } = await execAsync('getmac /fo csv /nh /v');

          const getmacLines = getmacOutput.trim().split(/\r?\n/).filter(line => line.trim());


          for (const line of getmacLines) {
            // Format: "Connection Name","Network Adapter","Physical Address","Transport Name"
            const csvMatch = line.match(/^"([^"]*)","([^"]*)","([0-9A-F-]{17})"/i);
            if (csvMatch) {
              const connectionName = csvMatch[1];
              const adapterName = csvMatch[2];
              const macAddress = csvMatch[3];



              // Skip WiFi adapters
              if (/wireless|wlan|wi-fi|802\.11|wifi/i.test(connectionName) || /wireless|wlan|wi-fi|802\.11|wifi/i.test(adapterName)) {

                continue;
              }

              // Skip Bluetooth and virtual adapters (but keep USB Ethernet)
              if (/bluetooth|microsoft.*wifi.*direct/i.test(adapterName)) {

                continue;
              }

              // Keep Ethernet adapters (including USB)
              if (/ethernet/i.test(connectionName) || /ethernet|usb.*gb/i.test(adapterName)) {
                const mac = macAddress.replace(/-/g, ':').toUpperCase();
                console.log(`[DEBUG] ✓ Found Ethernet adapter via getmac: ${adapterName} (${mac})`);
                return { macAddress: mac, adapterName: adapterName };
              } else {
                console.log(`[DEBUG] Skipping adapter (not Ethernet): ${connectionName} / ${adapterName}`);
              }
            }
          }
        } catch (getmacError: any) {

        }


        return { macAddress: null };
      } catch (error: any) {
        console.error('[DEBUG] ✗ Windows Ethernet MAC detection error:', error.message || error);
        console.error('[DEBUG] Error stack:', error.stack);
        return { macAddress: null };
      }
    } else if (platform === 'darwin') {
      // macOS: Use ifconfig or networksetup
      try {
        // Get list of Ethernet adapters (en0, en1, etc., excluding en0 if it's WiFi)
        const { stdout: networksetup } = await execAsync('networksetup -listallhardwareports');
        const lines = networksetup.split(/\r?\n/);

        let currentPort = '';
        let currentDevice = '';

        for (const line of lines) {
          if (line.includes('Hardware Port:')) {
            currentPort = line.split(':')[1].trim();
          }
          if (line.includes('Device:')) {
            currentDevice = line.split(':')[1].trim();

            // Skip WiFi ports
            if (/Wi-Fi|AirPort/i.test(currentPort)) {
              continue;
            }

            // Get MAC address for this device
            if (currentDevice && currentDevice.startsWith('en')) {
              try {
                const { stdout: ifconfig } = await execAsync(`ifconfig ${currentDevice}`);
                const macMatch = ifconfig.match(/ether\s+([0-9a-f:]{17})/i);
                if (macMatch) {
                  return { macAddress: macMatch[1].toUpperCase(), adapterName: currentPort };
                }
              } catch {
                // Continue to next device
              }
            }
          }
        }
      } catch (error: any) {
        console.error('macOS Ethernet MAC detection error:', error.message || error);
        return { macAddress: null };
      }
    } else if (platform === 'linux') {
      // Linux: Use ip link or ifconfig
      try {
        const { stdout } = await execAsync('ip link show');
        const lines = stdout.split(/\r?\n/);

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          // Skip WiFi interfaces (wlan, wlp, etc.)
          if (/^\d+:\s+(wlan|wlp|wl-)/i.test(line)) {
            continue;
          }

          // Look for Ethernet interfaces (eth, enp, eno, etc.)
          if (/^\d+:\s+(eth|enp|eno|ens|em)/i.test(line)) {
            const nextLine = i + 1 < lines.length ? lines[i + 1] : '';
            const macMatch = nextLine.match(/link\/ether\s+([0-9a-f:]{17})/i);
            if (macMatch) {
              const adapterMatch = line.match(/^\d+:\s+([^:]+):/);
              return {
                macAddress: macMatch[1].toUpperCase(),
                adapterName: adapterMatch ? adapterMatch[1].trim() : undefined
              };
            }
          }
        }
      } catch (error: any) {
        console.error('Linux Ethernet MAC detection error:', error.message || error);
        return { macAddress: null };
      }
    }
  } catch (error) {
    console.error('Error getting Ethernet MAC address:', error);
    return { macAddress: null };
  }

  return { macAddress: null };
}

/**
 * Get current Wi-Fi information (deprecated - use network.util)
 * @deprecated Use getCurrentWifi from utils/network.util
 */
async function getCurrentWifiLocal(): Promise<WifiInfo> {
  const platform = process.platform;

  try {
    if (platform === 'win32') {
      // Windows: Use netsh wlan show interfaces
      try {
        const { stdout } = await execAsync('netsh wlan show interfaces');

        // Split output into lines for easier parsing
        const lines = stdout.split(/\r?\n/);

        let ssid: string | null = null;
        let bssid: string | null = null;

        // Parse each line to find SSID and BSSID
        for (const line of lines) {
          // SSID format: "    SSID                   : Airtel_C3 wifi"
          // Match SSID (with optional leading whitespace) followed by colon
          // Exclude "Profile" line which also contains SSID value but is a different field
          if (/^\s*SSID\s*:/.test(line) && !/Profile/.test(line)) {
            const ssidPattern = /SSID\s*:\s*(.+)/i;
            const ssidMatch = line.match(ssidPattern);
            if (ssidMatch && ssidMatch[1]) {
              const foundSsid = ssidMatch[1].trim();
              // Skip if SSID is "none" or empty (not connected)
              if (foundSsid && foundSsid.toLowerCase() !== 'none' && foundSsid.length > 0) {
                ssid = foundSsid;
              }
            }
          }

          // BSSID format: "    AP BSSID               : 14:33:75:6a:c2:16" (Windows uses "AP BSSID")
          // Also try just "BSSID" as fallback for other formats
          if (/BSSID\s*:/.test(line)) {
            // Match "AP BSSID" or just "BSSID", capture the MAC address
            const bssidPattern = /(?:AP\s+)?BSSID\s*:\s*([0-9A-Fa-f]{2}[:-][0-9A-Fa-f]{2}[:-][0-9A-Fa-f]{2}[:-][0-9A-Fa-f]{2}[:-][0-9A-Fa-f]{2}[:-][0-9A-Fa-f]{2})/i;
            const bssidMatch = line.match(bssidPattern);
            if (bssidMatch && bssidMatch[1]) {
              // Normalize BSSID format (convert - to : and uppercase)
              bssid = bssidMatch[1].replace(/-/g, ':').toUpperCase();
            }
          }
        }

        return {
          ssid,
          bssid,
        };
      } catch (error: any) {
        console.error('Windows Wi-Fi detection error:', error.message || error);
        return { ssid: null, bssid: null };
      }
    } else if (platform === 'darwin') {
      // macOS: Use airport command or networksetup
      try {
        // Try airport command first (requires full path)
        const airportPath = '/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport';
        const { stdout } = await execAsync(`${airportPath} -I`);
        const ssidMatch = stdout.match(/^\s*SSID:\s*(.+)$/m);
        const bssidMatch = stdout.match(/^\s*BSSID:\s*([0-9a-f:]{17})/mi);

        return {
          ssid: ssidMatch ? ssidMatch[1].trim() : null,
          bssid: bssidMatch ? bssidMatch[1].trim().toUpperCase() : null,
        };
      } catch (error) {
        // Fallback to networksetup (less detailed, no BSSID)
        const { stdout } = await execAsync('networksetup -getairportnetwork en0');
        const ssidMatch = stdout.match(/Current Wi-Fi Network:\s*(.+)/);

        return {
          ssid: ssidMatch ? ssidMatch[1].trim() : null,
          bssid: null, // networksetup doesn't provide BSSID
        };
      }
    } else if (platform === 'linux') {
      // Linux: Try iwgetid first, then nmcli
      try {
        // Try iwgetid (requires root for BSSID, but works for SSID)
        const { stdout } = await execAsync('iwgetid -r');
        const ssid = stdout.trim();

        // Try to get BSSID using iwgetid with more options
        let bssid: string | null = null;
        try {
          const { stdout: bssidOutput } = await execAsync('iwgetid -ar');
          const bssidMatch = bssidOutput.match(/([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}/);
          bssid = bssidMatch ? bssidMatch[0].toUpperCase() : null;
        } catch {
          // BSSID not available without root
        }

        return {
          ssid: ssid || null,
          bssid,
        };
      } catch (error) {
        // Fallback to nmcli
        try {
          const { stdout } = await execAsync('nmcli -t -f active,ssid dev wifi | grep "^yes:" | head -1');
          const ssidMatch = stdout.match(/yes:(.+)/);
          return {
            ssid: ssidMatch ? ssidMatch[1].trim() : null,
            bssid: null, // nmcli requires more complex parsing for BSSID
          };
        } catch {
          return { ssid: null, bssid: null };
        }
      }
    }
  } catch (error) {
    console.error('Error getting Wi-Fi info:', error);
    return { ssid: null, bssid: null };
  }

  return { ssid: null, bssid: null };
}

// Register IPC handlers for network detection
// These use the utility functions from network.util.ts

// IPC handler for renderer-initiated focus recovery
ipcMain.on('force-focus-window', () => {
  runNonVisualFocusRecovery();
});

ipcMain.handle('get-current-wifi', async (): Promise<WifiInfo> => {
  return getCurrentWifi();
});

ipcMain.handle('get-current-network', async (): Promise<NetworkInfo> => {
  return getCurrentNetwork();
});

// Handle opening logs viewer
ipcMain.handle('open-logs-viewer', async () => {
  if (mainWindow) {
    mainWindow.webContents.send('open-logs-viewer');
    return true;
  }
  return false;
});

// Auto attendance IPC handlers
ipcMain.handle('auto-attendance:on-login', async () => {
  console.log('[AutoAttendance] Received login check-in request');
  try {
    const result = await autoAttendanceService.attemptAutoCheckIn('login');
    console.log(`[AutoAttendance] Login check-in result: ${result.success ? 'SUCCESS' : 'FAILED'} - ${result.reason || 'N/A'}`);
    return result;
  } catch (error: any) {
    console.error('[AutoAttendance] Login check-in failed with error:', error);
    return {
      success: false,
      trigger: 'login',
      reason: error.message || 'Unknown error',
      timestamp: new Date(),
    };
  }
});

// Handle auto check-in after auth initialization (when user has saved session)
ipcMain.handle('auto-attendance:on-auth-init', async () => {
  console.log('[AutoAttendance] Received auth-init check-in request');
  try {
    const result = await autoAttendanceService.attemptAutoCheckIn('app_start');
    console.log(`[AutoAttendance] Auth-init check-in result: ${result.success ? 'SUCCESS' : 'FAILED'} - ${result.reason || 'N/A'}`);
    return result;
  } catch (error: any) {
    console.error('[AutoAttendance] Auth init check-in failed with error:', error);
    return {
      success: false,
      trigger: 'app_start',
      reason: error.message || 'Unknown error',
      timestamp: new Date(),
    };
  }
});

// Handle getting proxy auto-start enabled setting
ipcMain.handle('proxy:get-autostart-enabled', async () => {
  try {
    return { enabled: configService.isProxyAutoStartEnabled() };
  } catch (error: any) {
    console.error('[Proxy] Failed to get auto-start setting:', error);
    return { enabled: false };
  }
});

// Handle setting proxy auto-start enabled
ipcMain.handle('proxy:set-autostart-enabled', async (_event, enabled: boolean) => {
  try {
    configService.setProxyAutoStartEnabled(enabled);
    return { success: true };
  } catch (error: any) {
    console.error('[Proxy] Failed to set auto-start setting:', error);
    return { success: false, error: error.message };
  }
});

// Handle auto-starting proxy after auth init if desired
ipcMain.handle('proxy:auto-start-if-desired', async () => {
  try {
    // Only auto-start if user has enabled the setting
    if (!configService.isProxyAutoStartEnabled()) {
      return { success: false, reason: 'Proxy auto-start disabled' };
    }

    // Start proxy server (service will handle auth/registration checks)
    const status = await proxyServerService.startProxyServer();
    return { success: true, status };
  } catch (error: any) {
    console.error('[Proxy] Failed to auto-start proxy server:', error);
    return { success: false, error: error.message };
  }
});

// Handle getting auto check-in enabled setting
ipcMain.handle('auto-attendance:get-enabled', async () => {
  try {
    return { enabled: configService.isAutoCheckInEnabled() };
  } catch (error: any) {
    console.error('[AutoAttendance] Failed to get auto check-in setting:', error);
    return { enabled: true }; // Default to enabled
  }
});

// Handle setting auto check-in enabled
ipcMain.handle('auto-attendance:set-enabled', async (_event, enabled: boolean) => {
  try {
    configService.setAutoCheckInEnabled(enabled);
    return { success: true };
  } catch (error: any) {
    console.error('[AutoAttendance] Failed to set auto check-in setting:', error);
    return { success: false, error: error.message };
  }
});

// Handle getting log file path
ipcMain.handle('get-log-path', async () => {
  const logPath = path.join(app.getPath('logs'), 'main.log');
  return logPath;
});

// Proxy server IPC handlers
ipcMain.handle('proxy:start', async () => {
  try {
    console.log('[Main] Starting proxy server...');
    const result = await proxyServerService.startProxyServer();
    console.log('[Main] Proxy server started:', result);
    return { success: true, ...result };
  } catch (error: any) {
    console.error('[Main] Failed to start proxy server:', error);
    return { success: false, error: error.message || 'Failed to start proxy server' };
  }
});

ipcMain.handle('proxy:stop', async () => {
  try {
    console.log('[Main] Stopping proxy server...');
    await proxyServerService.stopProxyServer();
    console.log('[Main] Proxy server stopped');
    return { success: true };
  } catch (error: any) {
    console.error('[Main] Failed to stop proxy server:', error);
    return { success: false, error: error.message || 'Failed to stop proxy server' };
  }
});

ipcMain.handle('proxy:status', async () => {
  try {
    const status = proxyServerService.getStatus();
    return { success: true, ...status };
  } catch (error: any) {
    console.error('[Main] Failed to get proxy status:', error);
    return { success: false, error: error.message || 'Failed to get proxy status' };
  }
});

// Handle getting API base URL from renderer process
ipcMain.handle('get-api-base-url', async () => {
  if (!mainWindow) {
    console.warn('[Main] Cannot get API base URL: mainWindow is null');
    return 'http://127.0.0.1:3001/api/v1'; // Default fallback (IPv4 to avoid ::1 issues)
  }

  try {
    // Read the API base URL from the renderer's window global variable
    // The renderer sets window.__API_BASE_URL__ from config.api.baseURL
    const apiBaseUrl = await mainWindow.webContents.executeJavaScript(`
      (() => {
        try {
          // Get from window.__API_BASE_URL__ set by renderer's main.tsx
          const url = window.__API_BASE_URL__ || 'http://127.0.0.1:3001/api/v1';
          // Replace localhost with 127.0.0.1 to force IPv4 and avoid IPv6 issues
          return url.replace(/localhost/g, '127.0.0.1');
        } catch (error) {
          console.error('Failed to get API base URL:', error);
          return 'http://127.0.0.1:3001/api/v1';
        }
      })()
    `);
    
    console.log('[Main] Got API base URL from renderer:', apiBaseUrl);
    return apiBaseUrl;
  } catch (error) {
    console.error('[Main] Failed to get API base URL from renderer:', error);
    return 'http://127.0.0.1:3001/api/v1'; // Default fallback (IPv4 to avoid ::1 issues)
  }
});

// Export getCurrentNetwork for auto-attendance service (re-export from utils)
export { getCurrentNetwork, NetworkInfo } from './utils/network.util';

// Keep app running in background - don't quit when windows are closed
app.on('window-all-closed', () => {
  // Don't quit - app runs in background via system tray
  // Only quit explicitly via tray menu or app.quit()
});

// Handle app quitting - Final safety net to save state if not already saved
app.on('before-quit', () => {
  // Only set flag if not already handling checkout
  if (!isCheckingOut) {
    appIsQuitting = true;
    if (mainWindow) {
      mainWindow.removeAllListeners('close');
    }
    
    // Final safety net: If user is checked in and state not saved, save it now
    // This handles cases where shutdown happens too fast
    (async () => {
      try {
        const isAuthenticated = await sessionService.isAuthenticated();
        if (isAuthenticated) {
          const status = await apiService.getAttendanceStatus();
          if (status.status === 'CHECKED_IN') {
            const sessionState = storageService.getLastSessionState();
            // Only save if not already saved
            if (!sessionState?.pendingCheckout || !sessionState?.sessionEndTimestamp) {
              const shutdownTimestamp = new Date();
              storageService.saveSessionState({
                ...sessionState,
                pendingCheckout: true,
                sessionEndTimestamp: shutdownTimestamp,
              });
              storageService.markSessionEnd(shutdownTimestamp);
              console.log('[AutoCheckout] Final safety net: Saved pending checkout state');
            }
          }
        }
      } catch (error) {
        // Ignore errors in final safety net
        console.error('[AutoCheckout] Final safety net error:', error);
      }
    })();
  }
});

// Security: Block in-app popups; open safe external schemes in the system browser / default handlers
app.on('web-contents-created', (_, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      const protocol = parsed.protocol.replace(':', '').toLowerCase();
      if (
        protocol === 'https' ||
        protocol === 'http' ||
        protocol === 'mailto' ||
        protocol === 'tel'
      ) {
        void shell.openExternal(url);
        return { action: 'deny' };
      }
    } catch {
      // ignore malformed URL
    }
    return { action: 'deny' };
  });

  // Prevent navigation to file:// URLs (only allow hash-based routing)
  contents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);

    // Allow navigation within the same origin (file://) but prevent file system navigation
    if (parsedUrl.protocol === 'file:') {
      // Only allow if it's the same file (index.html) with hash changes
      const currentUrl = contents.getURL();
      if (currentUrl && !navigationUrl.includes('index.html') && !navigationUrl.includes('#')) {
        event.preventDefault();
      }
    }
  });
});


