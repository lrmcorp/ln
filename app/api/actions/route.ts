import {NextResponse} from 'next/server';
import {z} from 'zod';
import {currentActor} from '@/lib/auth';
import {perform} from '@/lib/workflow';

const uuid=z.uuid();
const schema=z.discriminatedUnion('type',[
  z.object({type:z.literal('policy'),minPrincipal:z.number().int(),maxPrincipal:z.number().int(),flatInterestBps:z.number().int(),minWeeks:z.number().int(),maxWeeks:z.number().int()}),
  z.object({type:z.literal('customer'),name:z.string().min(1).max(200),nik:z.string().regex(/^[0-9]{16}$/),phone:z.string().min(8).max(20),bankName:z.string().min(1).max(100),accountNumber:z.string().regex(/^[0-9]{5,30}$/)}),
  z.object({type:z.literal('create'),customerId:uuid,principal:z.number().int().positive(),weeks:z.number().int().positive()}),
  z.object({type:z.literal('approve'),applicationId:uuid,reason:z.string().max(500).optional()}),
  z.object({type:z.literal('sign'),applicationId:uuid}),
  z.object({type:z.literal('authorize'),applicationId:uuid}),
  z.object({type:z.literal('initiate'),applicationId:uuid,idempotencyKey:z.string().min(1).max(100)}),
  z.object({type:z.literal('confirm'),applicationId:uuid,bankReference:z.string().regex(/^\d+$/),proof:z.string().min(1).max(500)}),
  z.object({type:z.literal('payment'),applicationId:uuid,bankReference:z.string().min(1).max(100),amount:z.number().int().positive()}),
  z.object({type:z.literal('close'),applicationId:uuid})
]);
export async function POST(request:Request){
  try {
    const origin=request.headers.get('origin');
    if(origin && new URL(origin).host!==request.headers.get('host')) return NextResponse.json({error:'Cross-origin request rejected'},{status:403});
    const actor=await currentActor();
    if(!actor) return NextResponse.json({error:'Sign in required'},{status:401});
    const action=schema.parse(await request.json());
    const result=await perform(actor,action);
    return NextResponse.json(result);
  }catch(error){
    const message=error instanceof Error?error.message:'Request failed';
    const conflict=/duplicate key|unique constraint/i.test(message);
    return NextResponse.json({error:conflict?'Duplicate reference or repeated operation':message},{status:conflict?409:400});
  }
}
