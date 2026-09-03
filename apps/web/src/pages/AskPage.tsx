import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ArrowUp, BookMarked, CheckCircle2, ChevronRight, FileText, MessageCircle, ShieldCheck, Sparkles, StickyNote } from 'lucide-react';
import type { Answer } from '@vani/shared';
import { api } from '../api';
import { useWorkspace } from '../context';
import { ErrorNotice, PageHeader } from '../components/ui';

const prompts=['What is the innovation of the selected work over its closest alternatives?','What are the key shortcomings, and who identified each one?','Compare the evaluation settings and baseline choices.'];

export function AskPage(){
  const {collectionId,selected}=useWorkspace();const [question,setQuestion]=useState('');const [conversation,setConversation]=useState<string>();const [messages,setMessages]=useState<Array<{question:string;answer:Answer}>>([]);const bottom=useRef<HTMLDivElement>(null);
  useEffect(()=>{setConversation(undefined);setMessages([])},[collectionId]);
  const ask=useMutation({mutationFn:async(q:string)=>{let id=conversation;if(!id){id=(await api.createConversation(collectionId)).id;setConversation(id)}return {q,answer:await api.ask(id,q,collectionId,selected.map(w=>w.id))}},onSuccess:result=>{setMessages(v=>[...v,{question:result.q,answer:result.answer}]);setQuestion('');setTimeout(()=>bottom.current?.scrollIntoView({behavior:'smooth'}),20)}});
  const submit=(q=question)=>{if(q.trim())ask.mutate(q.trim())};
  return <div className="page ask-page"><PageHeader eyebrow="Grounded synthesis" title="Ask VANI" description="Answers stay inside your chosen scope and link every substantive claim to stored evidence."/>
    <div className="ask-scope"><ShieldCheck size={17}/><div><strong>{selected.length?`${selected.length} selected papers`:'Active collection'}</strong><span>PDFs ✓ · Reviews ✓ · My notes ✓ · External web off</span></div><button>Change scope <ChevronRight size={14}/></button></div>
    <section className="conversation">{messages.length===0&&<div className="ask-welcome"><div className="vani-orb"><Sparkles/></div><h2>What do you want to understand?</h2><p>Compare contributions, trace ideas, surface limitations, or examine how evidence changed across a line of work.</p><div className="prompt-grid">{prompts.map(prompt=><button key={prompt} onClick={()=>submit(prompt)}><MessageCircle size={16}/>{prompt}</button>)}</div></div>}
      {messages.map((message,index)=><div className="exchange" key={index}><div className="user-message">{message.question}</div><div className="assistant-message"><div className="assistant-mark">V</div><div><div className="answer-label"><Sparkles size={14}/>Evidence-grounded answer</div>{message.answer.status==='insufficient_evidence'?<p>{message.answer.markdown}</p>:<div className="claims">{message.answer.claims.map((claim,i)=><div className="claim" key={claim.id}><p>{claim.text} <button className="cite">{i+1}</button></p><div className="claim-proof"><CheckCircle2 size={13}/><span>{claim.supportStatus.replaceAll('_',' ')}</span><span>·</span>{claim.evidence.map(ev=><button key={ev.sourceId} title={ev.exactText}>{ev.type==='user_note'?<StickyNote size={12}/>:<FileText size={12}/>} {ev.label}</button>)}</div></div>)}</div>}{message.answer.limitations.length>0&&<div className="answer-limit"><strong>Qualifications</strong>{message.answer.limitations.map(l=><p key={l}>{l}</p>)}</div>}<div className="answer-actions"><button><BookMarked size={14}/>Save as synthesis note</button><button>Show on map</button><span>{String(message.answer.modelProvenance.provider)} · claims validated</span></div></div></div></div>)}
      {ask.isPending&&<div className="assistant-message thinking"><div className="assistant-mark">V</div><div><span/><span/><span/><p>Planning evidence, retrieving passages, and validating claims…</p></div></div>}{ask.error&&<ErrorNotice error={ask.error}/>}<div ref={bottom}/></section>
    <div className="ask-composer"><textarea rows={2} value={question} onChange={e=>setQuestion(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();submit()}}} placeholder="Ask about innovation, evidence, methods, shortcomings…"/><button className="send-button" onClick={()=>submit()} disabled={ask.isPending||!question.trim()} aria-label="Send question"><ArrowUp size={19}/></button><div className="composer-foot"><span>Collection evidence only</span><span>Enter to send · Shift+Enter for new line</span></div></div>
  </div>
}
