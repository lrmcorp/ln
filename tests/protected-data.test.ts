import test from 'node:test';
import assert from 'node:assert/strict';
import {imageMime,protect,reveal,videoMime} from '../lib/protected-data';

test('identity evidence encryption round-trips and rejects a changed authentication tag',()=>{
  const original=Buffer.from('contoh data sintetis');
  const sealed=protect(original);
  assert.notDeepEqual(sealed.cipher,original);
  assert.deepEqual(reveal(sealed.cipher,sealed.iv,sealed.tag),original);
  const altered=Buffer.from(sealed.tag);altered[0]^=1;
  assert.throws(()=>reveal(sealed.cipher,sealed.iv,altered));
});

test('identity media types are recognized from bytes instead of filenames',()=>{
  assert.equal(imageMime(Buffer.from([0xff,0xd8,0xff,0x00])),'image/jpeg');
  assert.equal(imageMime(Buffer.from([137,80,78,71,13,10,26,10])),'image/png');
  assert.equal(videoMime(Buffer.from([26,69,223,163])),'video/webm');
  assert.equal(videoMime(Buffer.from([0,0,0,24,102,116,121,112])),'video/mp4');
  assert.equal(imageMime(Buffer.from('<script>')),null);
});
