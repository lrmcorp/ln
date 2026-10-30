package id.ln.lokasi;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

public final class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context,Intent intent){
        if(!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction()))return;
        SecretStore store=new SecretStore(context);
        if(!store.accepted()||store.token().isEmpty())return;
        boolean foreground=context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED
            ||context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED;
        boolean background=Build.VERSION.SDK_INT<29||context.checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION)==PackageManager.PERMISSION_GRANTED;
        if(foreground&&background)try{context.startForegroundService(new Intent(context,LocationService.class));}
        catch(RuntimeException ignored){/* Some Android versions block starting a location service at boot. Opening the app retries. */}
    }
}
