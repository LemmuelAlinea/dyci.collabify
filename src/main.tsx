import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './context/AuthProvider'
import { ThemeProvider } from './context/ThemeProvider'
import { ToastProvider } from './components/ui/ToastProvider'
import { UpdateNotice } from './components/app/UpdateNotice'
import { PageScrollbar } from './components/app/PageScrollbar'
import { installStaleBuildReload } from './lib/staleBuild'
import { registerAppWorker } from './lib/install'
import './styles/index.css'

installStaleBuildReload()
registerAppWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <App />
            <PageScrollbar />
            <UpdateNotice />
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
