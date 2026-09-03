import type { ReactNode } from 'react';
import { AlertTriangle, Check, LoaderCircle } from 'lucide-react';

export function PageHeader({eyebrow,title,description,actions}:{eyebrow?:string;title:string;description?:string;actions?:ReactNode}){return <div className="page-header"><div>{eyebrow&&<div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description&&<p>{description}</p>}</div>{actions&&<div className="header-actions">{actions}</div>}</div>}
export function EmptyState({icon,title,body,action}:{icon?:ReactNode;title:string;body:string;action?:ReactNode}){return <div className="empty-state">{icon}<h3>{title}</h3><p>{body}</p>{action}</div>}
export function Loading({label='Loading research…'}:{label?:string}){return <div className="loading"><LoaderCircle className="spin" size={20}/>{label}</div>}
export function ErrorNotice({error}:{error:unknown}){return <div className="error-notice"><AlertTriangle size={18}/><div><strong>Something needs attention</strong><span>{error instanceof Error?error.message:'The request could not be completed.'}</span></div></div>}
export function VerificationBadge({status}:{status:string}){const good=status.startsWith('verified');return <span className={`verification ${good?'good':status==='conflict'?'bad':'pending'}`}>{good?<Check size={12}/>:status==='conflict'?<AlertTriangle size={12}/>:null}{status.replaceAll('_',' ')}</span>}
export function Modal({title,children,onClose}:{title:string;children:ReactNode;onClose:()=>void}){return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><section className="modal" role="dialog" aria-modal="true"><header><h2>{title}</h2><button onClick={onClose} aria-label="Close">×</button></header>{children}</section></div>}
