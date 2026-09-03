import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { WorkspaceProvider } from './context';
import { App } from './App';
import './styles.css';

const client=new QueryClient({defaultOptions:{queries:{staleTime:15_000,retry:1}}});
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><QueryClientProvider client={client}><BrowserRouter><WorkspaceProvider><App/></WorkspaceProvider></BrowserRouter></QueryClientProvider></React.StrictMode>);
