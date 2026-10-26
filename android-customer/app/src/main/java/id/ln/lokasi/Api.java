package id.ln.lokasi;

import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

final class Api {
    static final class Result {
        final int status;
        final JSONObject body;
        Result(int status, JSONObject body) { this.status=status; this.body=body; }
        boolean ok() { return status>=200 && status<300; }
        String error() { return body.optString("error", "Server tidak dapat dihubungi"); }
    }

    static Result call(String server, String path, String method, String token, JSONObject payload) throws Exception {
        URL base=new URL(server);
        boolean secure="https".equals(base.getProtocol());
        if(!secure && !(BuildConfig.DEBUG && "http".equals(base.getProtocol())))
            throw new IllegalArgumentException("Gunakan alamat server HTTPS");
        if(base.getHost().isEmpty() || base.getUserInfo()!=null || base.getQuery()!=null || base.getRef()!=null)
            throw new IllegalArgumentException("Alamat server tidak valid");
        String root=server.endsWith("/")?server.substring(0,server.length()-1):server;
        URL url=new URL(root+path);
        HttpURLConnection connection=(HttpURLConnection)url.openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(15000);
        connection.setRequestMethod(method);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("Accept","application/json");
        connection.setUseCaches(false);
        if(!token.isEmpty())connection.setRequestProperty("Authorization","Bearer "+token);
        if(payload!=null){
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type","application/json; charset=utf-8");
            try(OutputStream output=connection.getOutputStream()){
                output.write(payload.toString().getBytes(StandardCharsets.UTF_8));
            }
        }
        try {
            int status=connection.getResponseCode();
            InputStream input=status>=400?connection.getErrorStream():connection.getInputStream();
            if(input==null)return new Result(status,new JSONObject());
            ByteArrayOutputStream bytes=new ByteArrayOutputStream();
            byte[] buffer=new byte[4096];int count;
            try(input){while((count=input.read(buffer))!=-1){
                if(bytes.size()+count>65536)throw new IllegalStateException("Respons server terlalu besar");
                bytes.write(buffer,0,count);
            }}
            return new Result(status,new JSONObject(new String(bytes.toByteArray(),StandardCharsets.UTF_8)));
        }finally{connection.disconnect();}
    }
}
