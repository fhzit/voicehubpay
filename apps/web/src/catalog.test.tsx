import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { App } from './app';

describe('product catalog demo', () => {
  it('keeps demo checkout visibly non-transactional and unavailable', () => {
    window.history.pushState({}, '', '/shop?view=cart');
    render(<App />);
    expect(screen.getByText(/checkout is unavailable/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /checkout|purchase|pay now|complete order/i })).toBeNull();
  });
  it('opens product details and presents loading, empty, and error controls', () => {
    window.history.pushState({}, '', '/shop?product=headphones');
    const view = render(<App />);
    expect(screen.getAllByRole('heading', { name: 'Monitor Headphones' }).length).toBe(2);
    view.unmount();
    window.history.pushState({}, '', '/shop');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Simulate loading' }));
    expect(screen.getByRole('status').textContent).toMatch(/loading/i);
  });
});
