rootProject.name = "Dino-World"

// Enable Gradle toolchain auto-provisioning. Without this, anyone
// running ./gradlew build needs JDK 25 (the version pinned in
// build.gradle.kts) installed on their machine. With this, Gradle
// downloads the right JDK from disco.foojay.io on first use and
// caches it under ~/.gradle/jdks/.
plugins {
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}
