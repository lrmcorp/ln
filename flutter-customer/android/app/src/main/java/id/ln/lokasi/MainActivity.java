package id.ln.lokasi;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.annotation.NonNull;
import io.flutter.embedding.android.FlutterActivity;
import io.flutter.embedding.engine.FlutterEngine;
import io.flutter.plugin.common.MethodChannel;
import java.util.HashMap;
import java.util.Map;

// Bridges the Flutter screens to the native Keystore token store and foreground location service,
// which are shared with the native demo app (android-customer/).
public final class MainActivity extends FlutterActivity {
    private MethodChannel.Result pendingPermission;

    private boolean granted(String permission){return checkSelfPermission(permission)==PackageManager.PERMISSION_GRANTED;}
    private Map<String,Object> permissions(){
        Map<String,Object> values=new HashMap<>();
        boolean foreground=granted(Manifest.permission.ACCESS_FINE_LOCATION)||granted(Manifest.permission.ACCESS_COARSE_LOCATION);
        values.put("foreground",foreground);
        values.put("background",foreground&&(Build.VERSION.SDK_INT<29||granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION)));
        values.put("notification",Build.VERSION.SDK_INT<33||granted(Manifest.permission.POST_NOTIFICATIONS));
        return values;
    }
    // Answers the Dart side once Android reports the user's choice.
    private void request(MethodChannel.Result result,String... permissions){
        if(pendingPermission!=null)pendingPermission.success(permissions());
        pendingPermission=result;
        requestPermissions(permissions,200);
    }
    @Override public void onRequestPermissionsResult(int requestCode,@NonNull String[] permissions,@NonNull int[] grants){
        super.onRequestPermissionsResult(requestCode,permissions,grants);
        if(requestCode==200&&pendingPermission!=null){pendingPermission.success(permissions());pendingPermission=null;}
    }

    @Override public void configureFlutterEngine(@NonNull FlutterEngine engine){
        super.configureFlutterEngine(engine);
        SecretStore store=new SecretStore(this);
        new MethodChannel(engine.getDartExecutor().getBinaryMessenger(),"id.ln.lokasi/native").setMethodCallHandler((call,result)->{
            try{
                switch(call.method){
                    case "credentials":{
                        Map<String,Object> values=new HashMap<>();
                        values.put("server",store.server());values.put("token",store.token());values.put("accepted",store.accepted());
                        result.success(values);break;
                    }
                    case "save":store.save(call.argument("server"),call.argument("token"));result.success(null);break;
                    case "setAccepted":store.setAccepted(Boolean.TRUE.equals(call.argument("value")));result.success(null);break;
                    case "clear":store.clear();result.success(null);break;
                    case "permissions":result.success(permissions());break;
                    case "requestForeground":request(result,Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION);break;
                    case "requestBackground":
                        // Android 11+ only grants "all the time" from the app's settings page.
                        if(Build.VERSION.SDK_INT>=30){startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getPackageName())));result.success(permissions());}
                        else if(Build.VERSION.SDK_INT==29)request(result,Manifest.permission.ACCESS_BACKGROUND_LOCATION);
                        else result.success(permissions());
                        break;
                    case "requestNotification":
                        if(Build.VERSION.SDK_INT>=33)request(result,Manifest.permission.POST_NOTIFICATIONS);else result.success(permissions());
                        break;
                    case "startService":startForegroundService(new Intent(this,LocationService.class));result.success(null);break;
                    default:result.notImplemented();
                }
            }catch(Exception error){result.error("native",error.getMessage(),null);}
        });
    }
}
