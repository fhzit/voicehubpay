import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Minus, Plus, ShoppingBag } from 'lucide-react';

export type Product = { id: number; name: string; slug: string; description: string; priceCents: number; status: 'draft' | 'active' | 'archived' };
type ProductListResponse = { products: Product[] };
const PRODUCT_API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const PRODUCT_API_TIMEOUT_MS = 10_000;
const PRODUCT_API_MAX_ATTEMPTS = 2;
async function fetchProducts(signal: AbortSignal): Promise<Product[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt < PRODUCT_API_MAX_ATTEMPTS; attempt += 1) {
    if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(signal.reason);
    signal.addEventListener('abort', abortFromCaller, { once: true });
    const timeoutId = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), PRODUCT_API_TIMEOUT_MS);
    try {
      const response = await fetch(`${PRODUCT_API_BASE}/api/products`, { signal: controller.signal });
      if (response.status === 408 || response.status === 429 || response.status >= 500) throw new Error(`Product request failed (${response.status})`);
      if (!response.ok) throw new Error(`Product request failed (${response.status})`);
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== 'object' || !Array.isArray((payload as ProductListResponse).products) || !(payload as ProductListResponse).products.every(product => product && Number.isInteger(product.id) && typeof product.name === 'string' && typeof product.slug === 'string' && typeof product.description === 'string' && Number.isFinite(product.priceCents) && product.priceCents >= 0 && ['draft', 'active', 'archived'].includes(product.status))) throw new Error('Invalid product response');
      return (payload as ProductListResponse).products;
    } catch (error) {
      if (signal.aborted) throw signal.reason ?? error;
      lastError = error;
      if (attempt + 1 === PRODUCT_API_MAX_ATTEMPTS) throw error;
    } finally {
      clearTimeout(timeoutId);
      signal.removeEventListener('abort', abortFromCaller);
    }
  }
  throw lastError;
}
const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

export function QuantitySelector({ value, onChange, label = 'Quantity' }: { value: number; onChange: (value: number) => void; label?: string }) {
  return <div className="quantity-control"><span>{label}</span><div><button type="button" aria-label="Decrease quantity" disabled={value <= 1} onClick={() => onChange(Math.max(1, value - 1))}><Minus size={15}/></button><output aria-live="polite" aria-label="Selected quantity">{value}</output><button type="button" aria-label="Increase quantity" disabled={value >= 99} onClick={() => onChange(Math.min(99, value + 1))}><Plus size={15}/></button></div></div>;
}

export function Storefront({ account = false }: { account?: boolean }) {
  const [params, setParams] = useSearchParams();
  const selected = params.get('product');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [cart, setCart] = useState<Record<string, number>>({});
  const [products, setProducts] = useState<Product[]>([]);
  const [status, setStatus] = useState<'loading'|'ready'|'error'>('loading');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    fetchProducts(controller.signal).then(result => { setProducts(result); setStatus('ready'); }).catch(() => { if (!controller.signal.aborted) setStatus('error'); });
    return () => controller.abort();
  }, [retry]);
  const product = products.find(item => String(item.id) === selected);
  const cartCount = Object.values(cart).reduce((sum, qty) => sum + qty, 0);
  const quantity = (id: number) => quantities[String(id)] ?? 1;
  const setQuantity = (id: number, value: number) => setQuantities(previous => ({ ...previous, [String(id)]: value }));
  const addToCart = (item: Product) => setCart(previous => ({ ...previous, [String(item.id)]: (previous[String(item.id)] ?? 0) + quantity(item.id) }));
  const subtotal = Object.entries(cart).reduce((sum, [id, qty]) => sum + (products.find(item => String(item.id) === id)?.priceCents ?? 0) * qty, 0);
  return <div className="public-shell"><header className="public-header"><Link className="brand" to="/shop"><span className="brand-mark">V</span><span>VoiceHub<span className="brand-pay">Pay</span></span></Link><nav aria-label="Primary"><Link to="/shop" aria-current={!account ? 'page' : undefined}>Shop</Link><Link to="/account" aria-current={account ? 'page' : undefined}>My account</Link><Link to="/admin">Admin</Link><button className="button button-outline cart-link" type="button" onClick={() => setParams({ view: 'cart' })}><ShoppingBag size={16}/> Cart ({cartCount})</button></nav></header><main className="public-content">
    <p className="eyebrow">VOICEHUB STORE · PREVIEW</p><h1>{account ? 'My account' : selected && product ? product.name : params.get('view') === 'checkout' ? 'Demo checkout' : params.get('view') === 'cart' ? 'Your cart' : 'Shop'}</h1>
    <p className="muted">{account ? 'Account and order history preview.' : 'Explore the VoiceHub catalog.'}</p><p className="demo-note" role="note">Demo cart only · Prices shown for display in USD. No live purchases, payments, or orders.</p>
    {!account && <p className="sr-only" role="status" aria-live="polite">{status === 'loading' ? 'Loading product catalog' : status === 'ready' ? 'Product catalog loaded' : ''}</p>}
    {account ? <section className="card empty-state"><h2>No account activity</h2><p className="muted">Sign-in and order history are not connected in this demo.</p></section> : status === 'loading' ? <section className="card loading-state" role="status" aria-live="polite">Loading product catalog…</section> : status === 'error' ? <section className="card empty-state" role="alert"><h2>Catalog unavailable</h2><p className="muted">The product catalog could not be loaded due to a network or server error. Please try again.</p><button className="button button-outline" onClick={() => setRetry(value => value + 1)}>Try again</button></section> : params.get('view') === 'checkout' ? <section className="card checkout-panel"><h2>Checkout preview</h2><p className="muted">This is a demo only. Checkout is not connected to payment processing and no purchase will be made.</p><p><strong>Demo total: {money(subtotal)}</strong></p><button className="button button-outline" onClick={() => setParams({ view: 'cart' })}>Back to cart</button></section> : params.get('view') === 'cart' ? <section className="card cart-panel"><h2>Cart · demo</h2>{cartCount === 0 ? <p className="muted">Your demo cart is empty.</p> : <>{Object.entries(cart).map(([id, qty]) => { const item = products.find(p => String(p.id) === id); return item ? <div className="cart-row" key={id}><span>{item.name} × {qty}</span><strong>{money(item.priceCents * qty)}</strong></div> : null; })}<div className="cart-row cart-total"><strong>Subtotal</strong><strong>{money(subtotal)}</strong></div></>}<p className="demo-note" role="note">Checkout is unavailable in this preview. No orders or payments can be submitted.</p><button className="text-button" onClick={() => setParams({})}>Continue shopping</button></section> : selected ? product ? <section className="card product-detail"><Link className="text-button" to="/shop">← Back to catalog</Link><div className="product-art" aria-hidden="true">♫</div><p className="eyebrow">Product</p><h2>{product.name}</h2><p className="muted">{product.description}</p><strong className="product-price">{money(product.priceCents)}</strong><QuantitySelector value={quantity(product.id)} onChange={value => setQuantity(product.id, value)}/><button className="button button-primary" onClick={() => addToCart(product)}>Add to demo cart</button><p className="muted">Demo interaction only; no order is placed.</p></section> : <section className="card empty-state"><h2>Product not found</h2><p className="muted">This product is unavailable in the catalog.</p><Link className="text-button" to="/shop">Back to catalog</Link></section> : products.length === 0 ? <section className="card empty-state"><h2>No products found</h2><p className="muted">The product catalog is currently empty.</p></section> : <><div className="catalog-tools"><span className="muted">{products.length} products</span></div><section className="product-grid" aria-label="Products">{products.map(item => <article className="card product-card" key={item.id}><div className="product-art" aria-hidden="true">♫</div><p className="eyebrow">Product</p><h2><Link to={`/shop?product=${item.id}`}>{item.name}</Link></h2><p className="muted">{item.description}</p><strong className="product-price">{money(item.priceCents)}</strong><QuantitySelector value={quantity(item.id)} onChange={value => setQuantity(item.id, value)}/><button className="button button-primary" onClick={() => addToCart(item)}>Add to demo cart</button><Link className="text-button" to={`/shop?product=${item.id}`}>View details</Link></article>)}</section></>}
  </main></div>;
}
