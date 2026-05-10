import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { HashRouter } from 'react-router-dom'
import App from './App'

describe('App', () => {
  it('renders navigation', () => {
    render(
      <HashRouter
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true
        }}
      >
        <App />
      </HashRouter>
    )
    expect(screen.getByText('PrivateAI Launcher')).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Main' })).getByText('Check my PC')).toBeInTheDocument()
    expect(screen.getByText('Installed apps')).toBeInTheDocument()
  })
})
