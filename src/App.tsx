import { AppShell } from './app/AppShell'
import { ThemeProvider } from './theme/ThemeContext'
import './App.css'
import './styles/shared-ui.css'

function App() {
  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  )
}

export default App
