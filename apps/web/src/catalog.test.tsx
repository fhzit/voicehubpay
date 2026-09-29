import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const apiProducts = [{ id: 42, name: 'API Microphone', slug: 'api-mic', description: 'Fetched from API', priceCents: 4250, status: 'active' as const }];

describe('catalog API integration', () => {
  it('renders API products in listing and detail with typed server fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ products: apiProducts }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    window.history.pushState({}, '', '/shop');
    const view = render(<App />);
    expect(await screen.findByRole('link', { name: 'API Microphone' })).toBeTruthy();
    expect(screen.queryByText('Studio Microphone')).toBeNull();
    view.unmount();
    window.history.pushState({}, '', '/shop?product=42');
    const detailFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ products: apiProducts }), { status: 200 }));
    vi.stubGlobal('fetch', detailFetch);
    render(<App />);
    expect(await screen.findByText('Fetched from API')).toBeTruthy();
    expect(screen.getByText('$42.50')).toBeTruthy();
    expect(detailFetch).toHaveBeenCalledWith('/api/products', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });
  it('recovers from API error by retrying the route', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 503 })).mockResolvedValueOnce(new Response('{}', { status: 503 })).mockResolvedValueOnce(new Response(JSON.stringify({ products: apiProducts }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    window.history.pushState({}, '', '/shop');
    render(<App />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('link', { name: 'API Microphone' })).toBeTruthy();
  });
  it('automatically retries a transient network failure before rendering products', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(new Response(JSON.stringify({ products: apiProducts }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    window.history.pushState({}, '', '/shop');
    render(<App />);
    expect(await screen.findByRole('link', { name: 'API Microphone' })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('shows an accessible error and permits retry after a network failure', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(new Response(JSON.stringify({ products: apiProducts }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    window.history.pushState({}, '', '/shop');
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Catalog unavailable');
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('link', { name: 'API Microphone' })).toBeTruthy();
  });
  it('rejects malformed product records with an accessible status and retry', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ products: [{ id: 'bad' }] }), { status: 200 })).mockRejectedValueOnce(new TypeError('offline')).mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(new Response(JSON.stringify({ products: apiProducts }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    window.history.pushState({}, '', '/shop');
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Catalog unavailable');
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('link', { name: 'API Microphone' })).toBeTruthy();
  });
  it('aborts an in-flight request when the storefront unmounts without showing an error', async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url: string, options: { signal: AbortSignal }) => {
      signal = options.signal;
      return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
    }));
    window.history.pushState({}, '', '/shop');
    const view = render(<App />);
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });
  it('shows an empty state for an empty API response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ products: [] }), { status: 200 })));
    window.history.pushState({}, '', '/shop');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'No products found' })).toBeTruthy();
  });
});
import { App } from './app';

describe('product catalog demo', () => {
  it('keeps demo checkout visibly non-transactional and unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ products: apiProducts }), { status: 200 })));
    window.history.pushState({}, '', '/shop?view=cart');
    render(<App />);
    expect(await screen.findByText(/checkout is unavailable/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /checkout|purchase|pay now|complete order/i })).toBeNull();
  });
  it('opens product details and presents loading, empty, and error controls', async () => {
    window.history.pushState({}, '', '/shop?product=2');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ products: [{ ...apiProducts[0], id: 2, name: 'Monitor Headphones' }] }), { status: 200 })));
    const view = render(<App />);
    expect(await screen.findByText('Fetched from API')).toBeTruthy();
    view.unmount();
    window.history.pushState({}, '', '/shop');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ products: apiProducts }), { status: 200 })));
    render(<App />);
    expect(await screen.findByRole('link', { name: 'API Microphone' })).toBeTruthy();
  });
});
