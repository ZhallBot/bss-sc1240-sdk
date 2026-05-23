package com.bss.parking.fieldapp;

import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.view.animation.AlphaAnimation;
import android.view.animation.Animation;
import android.widget.ImageView;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;

/**
 * Splash screen shown on app launch for 2 seconds.
 */
public class SplashActivity extends AppCompatActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_splash);

        // Fade in animation
        TextView logo = findViewById(R.id.splash_logo);
        TextView title = findViewById(R.id.splash_title);
        TextView subtitle = findViewById(R.id.splash_subtitle);

        AlphaAnimation fadeIn = new AlphaAnimation(0f, 1f);
        fadeIn.setDuration(800);
        fadeIn.setFillAfter(true);
        logo.startAnimation(fadeIn);
        title.startAnimation(fadeIn);
        subtitle.startAnimation(fadeIn);

        // Navigate to MainActivity after 2s
        new Handler().postDelayed(() -> {
            startActivity(new Intent(this, MainActivity.class));
            finish();
            overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out);
        }, 2000);
    }
}
