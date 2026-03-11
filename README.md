# Busiman Desktop Application

A desktop application built with Electron and React for the Busiman system.

## Features

- 🔐 Role-based authentication (Admin, HR, Manager, Employee)
- 🎨 Modern UI with React
- 📱 Responsive design
- 🔒 Secure token management
- 🚀 Fast development with Vite

## Prerequisites

- Node.js >= 18.0.0
- npm >= 9.0.0
- Backend server running on port 3001

## Installation

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file in the root directory:
```
VITE_API_BASE_URL=http://localhost:3001/api/v1
```

3. Start the development server:
```bash
npm run dev
```

## Available Scripts

- `npm run dev` - Start development server (Vite + Electron)
- `npm run build` - Build for production
- `npm run build:vite` - Build React app only
- `npm run build:electron` - Build Electron main process only
- `npm run build:win` - Build Windows installer (NSIS), no code signing

### Building for Windows

If you see **"Cannot create symbolic link: A required privilege is not held by the client"** when running `npm run build:win`:

1. **Option A (recommended):** Enable **Developer Mode** so Windows allows creating symlinks:
   - Open **Settings** → **Privacy & security** → **For developers**
   - Turn **Developer Mode** **On**
   - Clear the build cache and retry:
     ```bash
     rmdir /s /q "%LOCALAPPDATA%\electron-builder\Cache"
     npm run build:win
     ```

2. **Option B:** The config uses `signAndEditExecutable: false` to avoid loading the code-signing tool; if the error persists, use Option A.

## Project Structure

```
desktop-app/
├── electron/          # Electron main process
│   ├── main.ts        # Main process entry
│   └── preload.ts     # Preload script
├── src/
│   ├── components/    # React components
│   ├── pages/         # Page components
│   ├── services/      # API services
│   ├── store/         # State management (Zustand)
│   ├── router/        # React Router setup
│   ├── types/         # TypeScript types
│   └── config/        # App configuration
└── dist/              # Build output
```

## Authentication

The app uses JWT tokens for authentication. Tokens are stored securely using Zustand's persist middleware.

## Role-Based Access

- **Admin**: Full system access
- **HR**: Human resources management
- **Manager**: Team management
- **Employee**: Personal dashboard

## Development

The app uses path aliases (`@/`) for imports. Make sure your IDE is configured to recognize these aliases.

# desktop-application
# desktop-application
