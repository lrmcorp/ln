package id.ln.lokasi;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.Set;
import org.json.JSONObject;

public final class LocationService extends Service implements LocationListener {
    private static final String CHANNEL="ln_location_active";
    private ScheduledExecutorService worker;
    private LocationManager manager;
    private SecretStore store;
    private long lastReportMs=0;
    private final AtomicBoolean stopping=new AtomicBoolean(false);
    private final Set<String> registeredProviders=ConcurrentHashMap.newKeySet();

    @Override public IBinder onBind(Intent intent){return null;}
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(worker!=null)return START_STICKY;
        store=new SecretStore(this);
        if(store.token().isEmpty()||!store.accepted()||!hasPermissions()){stopSelf();return START_NOT_STICKY;}
        NotificationManager notifications=getSystemService(NotificationManager.class);
        notifications.createNotificationChannel(new NotificationChannel(CHANNEL,"Berbagi lokasi pinjaman",NotificationManager.IMPORTANCE_LOW));
        Intent stopIntent=new Intent(this,StopSharingReceiver.class);
        PendingIntent stopAction=PendingIntent.getBroadcast(this,0,stopIntent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Notification notification=new Notification.Builder(this,CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation).setContentTitle("LN Lokasi aktif")
            .setContentText("Lokasi dibagikan selama pinjaman aktif")
            .setOngoing(true).addAction(android.R.drawable.ic_menu_close_clear_cancel,"Hentikan berbagi",stopAction).build();
        try{
            if(Build.VERSION.SDK_INT>=29)startForeground(1001,notification,ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            else startForeground(1001,notification);
            manager=getSystemService(LocationManager.class);
            registerProviders();
            worker=Executors.newSingleThreadScheduledExecutor();
            worker.scheduleWithFixedDelay(this::checkStatus,0,30,TimeUnit.SECONDS);
            return START_STICKY;
        }catch(SecurityException error){withdrawAfterPermissionLoss();return START_NOT_STICKY;}
    }
    private boolean hasPermissions(){
        boolean foreground=checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED
            ||checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED;
        return foreground&&(Build.VERSION.SDK_INT<29||checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION)==PackageManager.PERMISSION_GRANTED);
    }
    private void withdrawAfterPermissionLoss(){
        if(!stopping.compareAndSet(false,true))return;
        store.setAccepted(false);
        new Thread(()->{try{Api.call(store.server(),"/api/mobile/consent","POST",store.token(),new JSONObject().put("enabled",false));}catch(Exception ignored){}},"ln-revoke").start();
        stopSelf();
    }
    private void checkStatus(){
        if(!hasPermissions()){withdrawAfterPermissionLoss();return;}
        try{registerProviders();}catch(SecurityException error){withdrawAfterPermissionLoss();return;}
        try{
            Api.Result status=Api.call(store.server(),"/api/mobile/status","GET",store.token(),null);
            if(status.status==401){store.clear();stopSelf();return;}
            if(status.ok()&&(!status.body.optBoolean("active")||!status.body.optBoolean("enabled"))){
                store.setAccepted(false);stopSelf();
            }
        }catch(Exception ignored){/* Connectivity can return; the server still gates each location report. */}
    }
    private void registerProviders(){
        if(manager==null)return;
        for(String provider:new String[]{LocationManager.NETWORK_PROVIDER,LocationManager.GPS_PROVIDER}){
            if(registeredProviders.contains(provider))continue;
            try{
                if(manager.isProviderEnabled(provider)){
                    manager.requestLocationUpdates(provider,30000,0,this,Looper.getMainLooper());
                    registeredProviders.add(provider);
                }
            }catch(IllegalArgumentException ignored){/* Some devices have no network location provider. */}
        }
    }
    @Override public void onLocationChanged(Location location){
        if(worker==null||!hasPermissions()){if(!hasPermissions())withdrawAfterPermissionLoss();return;}
        long now=SystemClock.elapsedRealtime();
        if(now-lastReportMs<25000)return;
        lastReportMs=now;
        double latitude=location.getLatitude(),longitude=location.getLongitude();
        float accuracy=location.hasAccuracy()?location.getAccuracy():1000;
        worker.execute(()->{
            try{
                Api.Result result=Api.call(store.server(),"/api/mobile/report","POST",store.token(),
                    new JSONObject().put("latitude",latitude).put("longitude",longitude).put("accuracy",accuracy));
                if(result.status==401||result.status==409||result.body.optString("error").equals("Izin lokasi tidak aktif")){
                    store.setAccepted(false);stopSelf();
                }
            }catch(Exception ignored){/* Next GPS update retries after temporary connectivity loss. */}
        });
    }
    @Override public void onDestroy(){
        if(manager!=null)try{manager.removeUpdates(this);}catch(SecurityException ignored){}
        if(worker!=null)worker.shutdownNow();
        super.onDestroy();
    }
}
