import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
import { projectApi } from '../../../lib/project-api.mjs';
export const dynamic='force-dynamic';
async function handle(request:Request,context:{params:Promise<{segments?:string[]}>}){
 const {segments=[]}=await context.params;
 return projectApi(request,env,await getChatGPTUser(),segments);
}
export {handle as GET,handle as POST,handle as PUT,handle as DELETE};
