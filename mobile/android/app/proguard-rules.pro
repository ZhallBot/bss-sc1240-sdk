# Add project specific ProGuard rules here.
# Default rules are already included via getDefaultProguardFile('proguard-android-optimize.txt')

# Keep RxJava3
-keep class io.reactivex.rxjava3.** { *; }
-dontwarn io.reactivex.rxjava3.**

# Keep SC1240 SDK
-keep class com.bss.parking.fieldapp.sdk.** { *; }

# Keep model classes
-keep class com.bss.parking.fieldapp.model.** { *; }
