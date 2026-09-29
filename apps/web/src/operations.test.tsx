import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import { Account, Admin } from './operations';

const renderRoute = (element: React.ReactNode) => render(<BrowserRouter>{element}</BrowserRouter>);
afterEach(cleanup);

describe('account and admin demo flows', () => {
  it('shows accessible orders list and opens an order detail', () => {
    renderRoute(<Account />);
    expect(screen.getByRole('table', { name: /demo orders/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: /order #vh-1042/i }));
    expect(screen.getByRole('heading', { name: /order vh-1042/i })).toBeTruthy();
    expect(screen.getAllByText(/demo only/i).length).toBeGreaterThan(0);
  });
  it('offers profile and security sections with labeled editable forms', () => {
    renderRoute(<Account />);
    fireEvent.click(screen.getByRole('button', { name: /profile/i }));
    expect(screen.getByLabelText(/display name/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /security/i }));
    expect(screen.getByText(/password changes are disabled/i)).toBeTruthy();
  });
  it('shows product inventory table and provides demo product form', () => {
    renderRoute(<Admin />);
    expect(screen.getByRole('table', { name: /product inventory/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /add product/i }));
    expect(screen.getByLabelText(/product name/i)).toBeTruthy();
    expect(screen.getAllByText(/demo only/i).length).toBeGreaterThan(0);
  });
});
