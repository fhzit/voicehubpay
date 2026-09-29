import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { App } from './app';

describe('accessible navigation and transactions', () => {
  it('provides a keyboard-operable, labeled mobile navigation toggle', () => {
    window.history.pushState({}, '', '/');
    render(<App />);
    const menu = screen.getByRole('button', { name: /toggle navigation/i });
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(menu);
    expect(menu.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('link', { name: 'Products' }));
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
  });
  it('does not offer a checkout or transaction-completion action', () => {
    window.history.pushState({}, '', '/shop?view=cart');
    render(<App />);
    expect(screen.queryByRole('button', { name: /checkout|purchase|pay now|complete order/i })).toBeNull();
  });
});
