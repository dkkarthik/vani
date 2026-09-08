import { ImportsPage } from './pages/ImportsPage';
import { MetadataPage } from './pages/MetadataPage';
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import { BookOpen, Boxes, Compass, FileText, Library, Map, MessageCircle, Search, Settings, Sparkles } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useWorkspace } from './context';
import { CollectionPage } from './pages/CollectionPage';
import { DiscoverPage } from './pages/DiscoverPage';
import { MapPage } from './pages/MapPage';
import { AskPage } from './pages/AskPage';
import { LibraryPage } from './pages/LibraryPage';
import { ReaderPage } from './pages/ReaderPage';
import { SettingsPage } from './pages/SettingsPage';

const navigation=[
  ['Collections','/collections',Boxes],['Discover','/discover',Compass],['Map','/map',Map],['Read','/read',BookOpen],['Ask VANI','/ask',MessageCircle],['Library','/library',Library],['Settings','/settings',Settings]
] as const;

export function App(){
  const {collectionId,setCollectionId,selected}=useWorkspace(); const location=useLocation();
  const {data:collections}=useQuery({queryKey:['collections'],queryFn:api.collections});
  const active=collections?.items.find(c=>c.id===collectionId);
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">V</span><div><strong>VANI</strong><small>See how ideas connect.</small></div></div>
      <nav aria-label="Primary navigation">{navigation.map(([label,to,Icon])=><NavLink key={to} to={to} className={({isActive})=>isActive?'nav-link active':'nav-link'}><Icon size={18}/><span>{label}</span>{label==='Ask VANI'&&<Sparkles size={12} className="nav-spark"/>}</NavLink>)}</nav>
      <div className="sidebar-foot"><div className="privacy-dot"/><span>Local workspace</span><small>Private by default</small></div>
    </aside>
    <main className="main-shell">
      <header className="context-bar">
        <div className="context-title"><span>{location.pathname.split('/')[1]||'collections'}</span><strong>{active?.name??'All research'}</strong></div>
        <div className="context-actions">
          <label className="collection-select"><span>Scope</span><select aria-label="Active collection" value={collectionId??''} onChange={e=>setCollectionId(e.target.value||undefined)}><option value="">All library</option>{collections?.items.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></label>
          <div className="selection-pill" title="Selected papers"><FileText size={14}/>{selected.length} selected</div>
          <button className="icon-button" aria-label="Search"><Search size={17}/></button>
        </div>
      </header>
      <div className="route-stage"><Routes>
        <Route path="/" element={<Navigate to="/collections" replace/>}/>
        <Route path="/collections" element={<CollectionPage/>}/>
        <Route path="/discover" element={<DiscoverPage/>}/>
        <Route path="/map" element={<MapPage/>}/>
        <Route path="/read" element={<ReaderPage/>}/>
        <Route path="/read/:workId" element={<ReaderPage/>}/>
        <Route path="/ask" element={<AskPage/>}/>
        <Route path="/imports" element={<ImportsPage/>}/>
        <Route path="/works/:workId/metadata" element={<MetadataPage/>}/>
        <Route path="/library" element={<LibraryPage/>}/>
        <Route path="/settings" element={<SettingsPage/>}/>
      </Routes></div>
    </main>
  </div>
}
