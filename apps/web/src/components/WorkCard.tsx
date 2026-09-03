import { BookOpen, Check, Plus, Waypoints } from 'lucide-react';
import type { Work } from '@vani/shared';
import { VerificationBadge } from './ui';

export function WorkCard({work,selected,onSelect,onAdd,compact=false}:{work:Work;selected?:boolean;onSelect?:()=>void;onAdd?:()=>void;compact?:boolean}){
  return <article className={`work-card ${selected?'selected':''} ${compact?'compact':''}`}>
    {onSelect&&<button className="work-check" onClick={onSelect} aria-label={selected?'Deselect paper':'Select paper'}>{selected?<Check size={13}/>:null}</button>}
    <div className="work-main"><div className="work-meta"><span>{work.year??'n.d.'}</span><span>{work.venueAbbreviation.toUpperCase()}</span><VerificationBadge status={work.verificationStatus}/></div>
      <h3>{work.title}</h3><p className="authors">{work.authors.map(a=>`${a.given} ${a.family}`.trim()).join(', ')||'Unknown authors'}</p>
      {!compact&&<p className="abstract">{work.abstract||'No abstract is stored yet.'}</p>}
      <div className="work-footer"><code>{work.citationKey}</code><span>{work.doi?`doi:${work.doi}`:'Identifier pending'}</span></div>
    </div>
    <div className="work-actions">{onAdd&&<button className="button secondary small" onClick={onAdd}><Plus size={14}/>Add</button>}<a className="icon-button" href={`/read/${work.id}`} aria-label="Read paper"><BookOpen size={16}/></a><a className="icon-button" href={`/map?work=${work.id}`} aria-label="Show on map"><Waypoints size={16}/></a></div>
  </article>
}
