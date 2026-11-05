export type Role = 'participant' | 'organizer';
export interface User { id:number; username:string; display_name:string; role:Role }
export interface Task { id:number; title:string; statement:string; time_limit_ms:number; memory_limit_kb:number; tests:{input:string;output:string}[] }
export interface Contest { id:number; title:string; description:string; starts_at:string; duration_minutes:number; task_ids:number[]; organizer_id:number; registered:boolean }
export type Verdict = 'QUEUED'|'RUNNING'|'OK'|'WA'|'TLE'|'RE'|'CE'|'CHECKER_ERROR';
export interface Submission { id:number; contest_id:number; task_id:number; user_id:number; match_id:number|null; source_code:string; language:string; verdict:Verdict; created_at:string; checked_at:string|null; error:string|null }
export interface Match { id:number; mode:'duel'|'team'; contest_id:number; invite_code:string; status:'waiting'|'active'|'finished'; creator_id:number; participant_ids:number[]; started_at:string|null; ends_at:string|null; progress:{user_id:number;solved:number;elapsed_seconds:number}[]; winner_id:number|null }
export interface StandingRow { user_id:number; display_name:string; solved:number; elapsed_seconds:number; rank:number }
export interface Standings { contest_id:number; rows:StandingRow[] }
export interface LoginResponse { access_token:string; token_type:'bearer'; user:User }
export interface IntegrityReport { id:number; contest_id:number; created_at:string; engine:string; details:Record<string, unknown> }
export interface IntegrityConclusion { id:number; contest_id:number; organizer_id:number; subject_user_id:number; comment:string; created_at:string }
const API_BASE = (import.meta as ImportMeta & { env: { VITE_API_BASE_URL?: string } }).env.VITE_API_BASE_URL ?? '';
let authToken: string | null = null;
export function setApiToken(token:string|null){authToken=token;}
export class ApiError extends Error { constructor(public status:number, message:string){super(message);this.name='ApiError';} }
async function request<T>(path:string, init:RequestInit = {}):Promise<T>{
 const headers=new Headers(init.headers); headers.set('Accept','application/json');
 if(init.body) headers.set('Content-Type','application/json'); if(authToken) headers.set('Authorization',`Bearer ${authToken}`);
 let response:Response; try { response=await fetch(`${API_BASE}/api${path}`,{...init,headers}); } catch { throw new ApiError(0,'Не удалось подключиться к серверу. Попробуйте ещё раз.'); }
 if(!response.ok){let message=`Не удалось выполнить действие (${response.status})`; try {const body=await response.json() as {detail?:unknown}; if(typeof body.detail==='string')message=body.detail; else if(body.detail)message='Проверьте заполненные данные.';} catch { /* Keep HTTP status message. */ } throw new ApiError(response.status,message); }
 if(response.status===204)return undefined as T; return response.json() as Promise<T>;
}
const json=(body:unknown):RequestInit=>({method:'POST',body:JSON.stringify(body)});
export const api={
 login:(username:string,password:string)=>request<LoginResponse>('/auth/login',json({username,password})), me:()=>request<User>('/auth/me'),
 tasks:()=>request<Task[]>('/tasks'), task:(id:number)=>request<Task>(`/tasks/${id}`), createTask:(body:Omit<Task,'id'>)=>request<Task>('/tasks',json(body)),
 contests:()=>request<Contest[]>('/contests'), contest:(id:number)=>request<Contest>(`/contests/${id}`), createContest:(body:Omit<Contest,'id'|'organizer_id'|'registered'>)=>request<Contest>('/contests',json(body)), register:(id:number)=>request<{registered:boolean}>(`/contests/${id}/register`,json({})), standings:(id:number)=>request<Standings>(`/contests/${id}/standings`),
 submit:(body:{contest_id:number;task_id:number;source_code:string;match_id?:number})=>request<Submission>('/submissions',json(body)), submission:(id:number)=>request<Submission>(`/submissions/${id}`), submissions:(contestId:number)=>request<Submission[]>(`/submissions?contest_id=${encodeURIComponent(contestId)}`),
 createMatch:(body:{mode:'duel'|'team';contest_id:number})=>request<Match>('/matches',json(body)), match:(id:number)=>request<Match>(`/matches/${id}`), joinMatch:(invite_code:string)=>request<Match>('/matches/join',json({invite_code})), matchState:(id:number)=>request<Match>(`/matches/${id}/state`),
 matchSocket:(id:number,token:string)=>{const base=API_BASE||window.location.origin;const url=new URL(`/api/ws/matches/${id}`,base);url.protocol=url.protocol==='https:'?'wss:':'ws:';url.searchParams.set('token',token);return new WebSocket(url);}
 ,integritySubmissions:(contestId:number)=>request<Submission[]>(`/contests/${contestId}/integrity/submissions`),
 integrityReports:(contestId:number)=>request<IntegrityReport[]>(`/contests/${contestId}/integrity/reports`),
 integrityAnalyze:(contestId:number)=>request<IntegrityReport>(`/contests/${contestId}/integrity/analyze`,json({})),
 integrityConclusion:(contestId:number,body:{subject_user_id:number;comment:string})=>request<IntegrityConclusion>(`/contests/${contestId}/integrity/conclusions`,json(body))
};
