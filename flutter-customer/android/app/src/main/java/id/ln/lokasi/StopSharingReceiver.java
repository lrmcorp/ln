package id.ln.lokasi;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import org.json.JSONObject;

public final class StopSharingReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context,Intent intent){
        SecretStore store=new SecretStore(context);
        store.setAccepted(false);
        context.stopService(new Intent(context,LocationService.class));
        PendingResult pending=goAsync();
        new Thread(()->{
            try{Api.call(store.server(),"/api/mobile/consent","POST",store.token(),new JSONObject().put("enabled",false));}
            catch(Exception ignored){/* The server marks old reports stale if a device is offline. */}
            finally{pending.finish();}
        },"ln-stop-sharing").start();
    }
}
