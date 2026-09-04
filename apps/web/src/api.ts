import type { Answer, Collection, CollectionWork, DiscoverySeed, GraphProjection, SearchResult, Work } from '@vani/shared';

export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, { ...init, headers: { ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...init?.headers } });
  if (!response.ok) { const body = await response.json().catch(() => null); throw new ApiError(body?.error?.message ?? response.statusText, response.status); }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export const api = {
  health: () => request<{status:string;version:string}>('/health'),
  capabilities: () => request<Record<string,unknown>>('/capabilities'),
  works: (collectionId?: string, q?: string) => request<{items:Work[]}>(`/works?${new URLSearchParams({ ...(collectionId ? {collectionId} : {}), ...(q ? {q} : {}) })}`),
  work: (id: string) => request<Work>(`/works/${id}`),
  addWork: (input: Partial<Work>) => request<Work>('/works', { method: 'POST', body: JSON.stringify(input) }),
  collections: () => request<{items:Collection[]}>('/collections'),
  collectionMembers: (id:string) => request<{items:CollectionWork[]}>(`/collections/${id}/members`),
  configureDiscovery: (id:string,seed:DiscoverySeed) => request<DiscoverySeed>(`/collections/${id}/discovery`,{method:'POST',body:JSON.stringify(seed)}),
  seen: async (id:string,workIds:string[]) => {for(let index=0;index<workIds.length;index+=500)await request(`/collections/${id}/seen`,{method:'POST',body:JSON.stringify({workIds:workIds.slice(index,index+500)})});},
  refreshCollection: (id:string) => request(`/collections/${id}/refresh`,{method:'POST'}),
  retryFirstPass: (id:string,workId:string) => request(`/collections/${id}/members/${workId}/first-pass/retry`,{method:'POST'}),
  createCollection: (input: {name:string;description?:string}) => request<Collection>('/collections', { method:'POST',body:JSON.stringify(input) }),
  addMembers: (collectionId:string,workIds:string[]) => request(`/collections/${collectionId}/members`,{method:'POST',body:JSON.stringify({workIds})}),
  updateStatus: (collectionId:string,workId:string,status:string) => request(`/collections/${collectionId}/members/${workId}`,{method:'PATCH',body:JSON.stringify({status})}),
  exportUrl: (collectionId:string) => `/api/v1/collections/${collectionId}/exports`,
  exportBibtex: (collectionId:string) => fetch(`/api/v1/collections/${collectionId}/exports`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({format:'bibtex'})}),
  search: (query:string,collectionId?:string) => request<{items:SearchResult[]}>('/search',{method:'POST',body:JSON.stringify({query,scope:{collectionId}})}),
  discover: (query:string,sources:string[]) => request<{items:any[]}>('/discover',{method:'POST',body:JSON.stringify({query,sources})}),
  importCandidate: (candidate:any) => request<Work>('/discover/import',{method:'POST',body:JSON.stringify(candidate)}),
  graph: (collectionId?:string,workId?:string) => request<GraphProjection>('/graph/neighborhood',{method:'POST',body:JSON.stringify({collectionId,workId,limit:200})}),
  notes: (collectionId?:string,workId?:string) => request<{items:any[]}>(`/notes?${new URLSearchParams({...(collectionId?{collectionId}:{}),...(workId?{workId}:{})})}`),
  createNote: (input:any) => request('/notes',{method:'POST',body:JSON.stringify(input)}),
  createConversation: (collectionId?:string) => request<{id:string}>('/conversations',{method:'POST',body:JSON.stringify({collectionId})}),
  ask: (conversationId:string,question:string,collectionId?:string,ids?:string[]) => request<Answer>(`/conversations/${conversationId}/messages`,{method:'POST',body:JSON.stringify({question,scope:{type:ids?.length?'selected_manifestations':'collection',collectionId,ids},include:{notes:true,reviews:true,externalSearch:false}})}),
  uploadPdf: (workId:string,file:File) => { const form=new FormData();form.append('file',file);return request(`/works/${workId}/attachments`,{method:'POST',body:form}); }
};
