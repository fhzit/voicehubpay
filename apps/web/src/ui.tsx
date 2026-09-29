import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { clsx } from 'clsx';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'outline' | 'ghost' };
export function Button({ className, variant = 'primary', ...props }: ButtonProps) { return <button className={clsx('button', `button-${variant}`, className)} {...props}/>; }
export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) { return <section className={clsx('card', className)} {...props}/>; }
export function EmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) { return <section className="card empty-state" aria-labelledby="empty-state-title"><h2 id="empty-state-title">{title}</h2><p className="muted">{children}</p>{action}</section>; }
export function LoadingState({ label = 'Loading content' }: { label?: string }) { return <div className="card loading-state" role="status" aria-live="polite"><span className="loading-spinner" aria-hidden="true"/>{label}</div>; }
