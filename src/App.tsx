import { AppShell } from './app/AppShell'
import { ThemeProvider } from './theme/ThemeContext'
import './App.css'

function App() {
  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  )
}

export default App
