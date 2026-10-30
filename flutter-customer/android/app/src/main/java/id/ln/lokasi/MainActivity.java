package id.ln.lokasi;

import android.content.Intent;
import androidx.annotation.NonNull;
import io.flutter.embedding.android.FlutterActivity;
import io.flutter.embedding.engine.FlutterEngine;
import io.flutter.plugin.common.MethodChannel;
import java.util.HashMap;
import java.util.Map;

// Bridges the Flutter screens to the native Keystore token store and foreground location service,
// which are shared with the native demo app (android-customer/).
public final class MainActivity extends FlutterActivity {
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
                    case "startService":startForegroundService(new Intent(this,LocationService.class));result.success(null);break;
                    default:result.notImplemented();
                }
            }catch(Exception error){result.error("native",error.getMessage(),null);}
        });
    }
}
