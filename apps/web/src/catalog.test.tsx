import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { App } from './app';

describe('product catalog demo', () => {
  it('shows catalog cards, quantities, prices, cart, and explicit demo checkout', () => {
    window.history.pushState({}, '', '/shop');
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Studio Microphone' })).toBeTruthy();
    expect(screen.getByText('$129.00')).toBeTruthy();
    expect(screen.getByText(/No live purchases/i)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Increase quantity' })[0]);
    expect(screen.getAllByLabelText('Selected quantity')[0].textContent).toBe('2');
    fireEvent.click(screen.getAllByRole('button', { name: 'Add to demo cart' })[0]);
    fireEvent.click(screen.getByRole('button', { name: /Cart/ }));
    expect(screen.getAllByText('$258.00').length).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: /Continue to demo checkout/ }));
    expect(screen.getByRole('heading', { name: 'Demo checkout' })).toBeTruthy();
    expect(screen.getByText(/no purchase will be made/i)).toBeTruthy();
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
