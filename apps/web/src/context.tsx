import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Work } from '@vani/shared';
import { api } from './api';

type Workspace = { collectionId?:string; setCollectionId:(id?:string)=>void; selected:Work[]; toggle:(work:Work)=>void; clear:()=>void };
const WorkspaceContext=createContext<Workspace|null>(null);
export function WorkspaceProvider({children}:{children:ReactNode}) {
  const {data}=useQuery({queryKey:['collections'],queryFn:api.collections});
  const [collectionId,setCollectionId]=useState<string>(); const [selected,setSelected]=useState<Work[]>([]);
  const effective=collectionId ?? data?.items[0]?.id;
  const value=useMemo(()=>({collectionId:effective,setCollectionId,selected,toggle:(work:Work)=>setSelected((items)=>items.some(i=>i.id===work.id)?items.filter(i=>i.id!==work.id):[...items,work]),clear:()=>setSelected([])}),[effective,selected]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
export const useWorkspace=()=>{const value=useContext(WorkspaceContext);if(!value)throw new Error('WorkspaceProvider missing');return value};
