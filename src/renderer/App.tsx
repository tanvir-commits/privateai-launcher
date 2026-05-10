import { NavLink, Route, Routes } from 'react-router-dom'
import logoUrl from './assets/logo.png'
import Dashboard from './pages/Dashboard'
import HardwareDoctor from './pages/HardwareDoctor'
import InstallWizard from './pages/InstallWizard'
import Models from './pages/Models'
import Services from './pages/Services'
import Troubleshooting from './pages/Troubleshooting'
import InstalledApps from './pages/InstalledApps'

export default function App() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img src={logoUrl} alt="" className="brand-logo" width={28} height={28} />
          <span className="brand-text">PrivateAI Launcher</span>
        </div>
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
        <NavLink className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')} to="/installed">
          Installed apps
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
          <Route path="/installed" element={<InstalledApps />} />
          <Route path="/troubleshooting" element={<Troubleshooting />} />
        </Routes>
      </main>
    </div>
  )
}
