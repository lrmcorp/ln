import {redirect} from 'next/navigation';
import {currentActor} from '@/lib/auth';
import {verificationQueue} from '@/lib/payments';
import VerificationQueue from '../ui/VerificationQueue';
export const dynamic='force-dynamic';

export default async function Verification(){
  const actor=await currentActor();
  if(!actor||(actor.role!=='owner'&&actor.role!=='manager'))redirect('/');
  const queue=await verificationQueue(actor);
  return <VerificationQueue actor={{id:actor.id,name:actor.name,role:actor.role}} queue={JSON.parse(JSON.stringify(queue))}/>;
}
