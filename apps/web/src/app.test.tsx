import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './app';

describe('application shell', () => {
  it('shows dashboard navigation and dashboard content at the root route', () => {
    window.history.pushState({}, '', '/');
    render(<App />);
    expect(screen.getByRole('heading', { name: /dashboard/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /products/i })).toBeTruthy();
    expect(screen.getAllByText(/demo data only/i).length).toBeGreaterThan(0);
  });
  it('provides shop, account, and admin route shells with accessible navigation and demo states', () => {
    for (const [path, heading] of [['/shop', 'Shop'], ['/account', 'My account'], ['/admin', 'Admin console']] as const) {
      window.history.pushState({}, '', path);
      const { unmount } = render(<App />);
      expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
      expect(screen.getAllByText(/demo data only/i).length).toBeGreaterThan(0);
      expect(screen.getAllByRole('navigation', { name: /primary/i }).length).toBeGreaterThan(0);
      unmount();
    }
  });
  it('shows the login scaffold on the login route', () => {
    window.history.pushState({}, '', '/login');
    render(<App />);
    expect(screen.getByRole('heading', { name: /sign in/i })).toBeTruthy();
    expect(screen.getByLabelText(/email/i)).toBeTruthy();
  });
});
