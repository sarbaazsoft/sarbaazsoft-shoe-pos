import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val keystoreProps = Properties()
val keystorePropsFile = rootProject.file("keystore.properties")
if (keystorePropsFile.exists()) {
    keystorePropsFile.inputStream().use { keystoreProps.load(it) }
}

fun resolveSigningProp(envKey: String, propKey: String): String? {
    return System.getenv(envKey)?.takeIf { it.isNotBlank() }
        ?: keystoreProps.getProperty(propKey)?.takeIf { it.isNotBlank() }
}

val releaseStoreFilePath = resolveSigningProp("ANDROID_KEYSTORE_PATH", "storeFile")
val releaseStorePassword = resolveSigningProp("ANDROID_KEYSTORE_PASSWORD", "storePassword")
val releaseKeyAlias = resolveSigningProp("ANDROID_KEY_ALIAS", "keyAlias")
val releaseKeyPassword = resolveSigningProp("ANDROID_KEY_PASSWORD", "keyPassword")
val releaseStoreFile = releaseStoreFilePath?.let { rootProject.file(it) }
val hasReleaseSigning = releaseStoreFile != null &&
    !releaseStorePassword.isNullOrBlank() &&
    !releaseKeyAlias.isNullOrBlank() &&
    !releaseKeyPassword.isNullOrBlank() &&
    releaseStoreFile.exists()

android {
    namespace = "com.sarbaazsoft.shoepos"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.sarbaazsoft.shoepos"
        minSdk = 24
        targetSdk = 35
        versionCode = (project.findProperty("VERSION_CODE") as? String)?.toIntOrNull() ?: 124
        versionName = (project.findProperty("VERSION_NAME") as? String) ?: "1.2.4"

        val baseUrl = (project.findProperty("APP_BASE_URL") as? String)
            ?: "https://sarbaazsoft.cloud.run/"
        buildConfigField("String", "APP_BASE_URL", "\"$baseUrl\"")
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = releaseStoreFile
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            signingConfig = if (hasReleaseSigning) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
        }
        debug {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        buildConfig = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
}
