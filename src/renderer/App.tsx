import { NavLink, Route, Routes } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import HardwareDoctor from './pages/HardwareDoctor'
import InstallWizard from './pages/InstallWizard'
import Models from './pages/Models'
import Services from './pages/Services'
import Troubleshooting from './pages/Troubleshooting'

export default function App() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">PrivateAI Launcher</div>
        <NavLink className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')} to="/">
          Dashboard
        </NavLink>
        <NavLink className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')} to="/hardware">
          Hardware Doctor
        </NavLink>
        <NavLink className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')} to="/install">
          Install
        </NavLink>
        <NavLink className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')} to="/models">
          Models
        </NavLink>
        <NavLink className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')} to="/services">
          Services
        </NavLink>
        <NavLink className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')} to="/troubleshooting">
          Troubleshooting
        </NavLink>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/hardware" element={<HardwareDoctor />} />
          <Route path="/install" element={<InstallWizard />} />
          <Route path="/models" element={<Models />} />
          <Route path="/services" element={<Services />} />
          <Route path="/troubleshooting" element={<Troubleshooting />} />
        </Routes>
      </main>
    </div>
  )
}
