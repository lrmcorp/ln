package id.ln.lokasi;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

public final class MainActivity extends Activity {
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private SecretStore store;
    private boolean starting=false;
    private boolean notificationRequested=false;

    @Override public void onCreate(Bundle state){super.onCreate(state);store=new SecretStore(this);advance();}
    @Override protected void onResume(){super.onResume();if(store!=null&&store.accepted()&&!store.token().isEmpty()&&hasLocationPermission())ensureStarted();}
    @Override protected void onDestroy(){worker.shutdown();super.onDestroy();}

    private boolean foregroundAllowed(){return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED
        ||checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED;}
    private boolean hasLocationPermission(){return foregroundAllowed()&&(Build.VERSION.SDK_INT<29||
        checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION)==PackageManager.PERMISSION_GRANTED);}

    private LinearLayout panel(){
        LinearLayout layout=new LinearLayout(this);layout.setOrientation(LinearLayout.VERTICAL);layout.setPadding(28,40,28,32);
        ScrollView scroll=new ScrollView(this);scroll.addView(layout);setContentView(scroll);return layout;
    }
    private TextView text(LinearLayout layout,String value,int size){
        TextView view=new TextView(this);view.setText(value);view.setTextSize(size);view.setTextColor(Color.rgb(24,37,33));
        view.setPadding(0,0,0,22);layout.addView(view);return view;
    }
    private Button button(LinearLayout layout,String label,Runnable action){
        Button result=new Button(this);result.setText(label);result.setOnClickListener(view->action.run());layout.addView(result);return result;
    }
    private void message(String title,String body,String action,Runnable next){
        LinearLayout layout=panel();text(layout,title,25);text(layout,body,16);button(layout,action,next);
    }
    private void advance(){
        if(store.token().isEmpty()){showEnrollment();return;}
        if(!store.accepted()){showConsent();return;}
        if(!foregroundAllowed()){showForegroundPermission();return;}
        if(!hasLocationPermission()){showBackgroundPermission();return;}
        ensureStarted();
    }
    private void showEnrollment(){
        LinearLayout layout=panel();text(layout,"Pemasangan LN Lokasi",25);
        text(layout,"Masukkan alamat server HTTPS dan kode sekali pakai dari petugas. Pemasangan hanya dapat dibuat untuk pinjaman yang sudah aktif.",16);
        EditText server=new EditText(this);server.setHint("https://alamat-server");server.setInputType(17);
        layout.addView(server);EditText code=new EditText(this);code.setHint("Kode pemasangan");code.setSingleLine(true);layout.addView(code);
        TextView error=text(layout,"",14);
        button(layout,"Pasang di perangkat ini",()->{
            String url=server.getText().toString().trim(),value=code.getText().toString().trim();
            if(!url.startsWith("https://")&&!(BuildConfig.DEBUG&&url.startsWith("http://"))){error.setText("Gunakan alamat HTTPS yang diberikan petugas.");return;}
            if(value.length()!=24){error.setText("Kode pemasangan terdiri dari 24 karakter.");return;}
            error.setText("Menghubungkan perangkat…");
            worker.execute(()->{
                try{
                    Api.Result result=Api.call(url,"/api/mobile/activate","POST","",new JSONObject().put("code",value));
                    if(!result.ok())throw new IllegalStateException(result.error());
                    store.save(url,result.body.getString("token"));runOnUiThread(this::showConsent);
                }catch(Exception cause){runOnUiThread(()->error.setText(cause.getMessage()==null?"Pemasangan gagal":cause.getMessage()));}
            });
        });
        text(layout,"Lokasi hanya dilaporkan setelah izin diberikan, saat pinjaman aktif. Aplikasi akan menampilkan pemberitahuan Android selama pelaporan berjalan.",14);
    }
    private void showConsent(){
        message("Izin berbagi lokasi","Saya setuju membagikan perkiraan lokasi kepada superadmin dan manajer cabang selama pinjaman aktif. Petugas lapangan tidak dapat melihatnya. Android akan meminta izin lokasi sepanjang waktu dan menampilkan pemberitahuan saat layanan berjalan.",
            "Setuju dan lanjutkan",()->{store.setAccepted(true);advance();});
    }
    private void showForegroundPermission(){
        message("Izin lokasi perangkat","Berikan izin lokasi saat aplikasi digunakan. Setelah itu, aktifkan izin sepanjang waktu agar pelaporan tetap berjalan ketika layar aplikasi ditutup.",
            "Izinkan lokasi",()->requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},100));
    }
    private void showBackgroundPermission(){
        message("Izin lokasi sepanjang waktu","Di pengaturan Android, pilih izin lokasi 'Izinkan sepanjang waktu'. Kembali ke aplikasi setelah izin tersimpan. Tanpa izin ini, pelaporan latar belakang tidak dimulai.",
            "Buka pengaturan aplikasi",()->{
                Intent intent=new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getPackageName()));
                startActivity(intent);
            });
    }
    @Override public void onRequestPermissionsResult(int requestCode,String[] permissions,int[] grants){
        super.onRequestPermissionsResult(requestCode,permissions,grants);
        if(requestCode==100)advance();
        if(requestCode==101)ensureStarted();
    }
    private void ensureStarted(){
        if(starting||!store.accepted()||store.token().isEmpty()||!hasLocationPermission())return;
        if(Build.VERSION.SDK_INT>=33&&!notificationRequested&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){
            notificationRequested=true;requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},101);return;
        }
        starting=true;
        worker.execute(()->{
            try{
                Api.Result status=Api.call(store.server(),"/api/mobile/status","GET",store.token(),null);
                if(status.status==401){store.clear();runOnUiThread(()->{starting=false;showEnrollment();});return;}
                if(!status.ok())throw new IllegalStateException(status.error());
                if(!status.body.optBoolean("active")){runOnUiThread(()->{starting=false;message("Pinjaman belum aktif","Pelaporan lokasi dimulai setelah pinjaman aktif.","Periksa lagi",this::ensureStarted);});return;}
                if(!status.body.optBoolean("enabled")){
                    Api.Result consent=Api.call(store.server(),"/api/mobile/consent","POST",store.token(),new JSONObject().put("enabled",true));
                    if(!consent.ok())throw new IllegalStateException(consent.error());
                }
                runOnUiThread(()->{
                    starting=false;
                    try{startForegroundService(new Intent(this,LocationService.class));showBlank();}
                    catch(SecurityException error){showBackgroundPermission();}
                });
            }catch(Exception cause){runOnUiThread(()->{starting=false;message("Lokasi belum aktif",cause.getMessage()==null?"Periksa jaringan dan coba lagi.":cause.getMessage(),"Coba lagi",this::ensureStarted);});}
        });
    }
    private void showBlank(){View blank=new View(this);blank.setBackgroundColor(Color.rgb(245,243,238));setContentView(blank);}
}
