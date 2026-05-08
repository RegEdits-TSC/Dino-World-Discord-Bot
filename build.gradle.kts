/*
 * Dino-World — Gradle build script.
 *
 * Single source of truth for dependency versions: edit the `val` constants
 * in the "Dependency versions" block below to bump anything. The build is
 * intentionally flat — no version catalogs, no platform BOMs except JUnit's.
 *
 * Bot version: edit the `version` field below. The shadow jar embeds it as
 * Implementation-Version, AboutCommand reads it at runtime from the manifest,
 * and the launcher scripts glob `Dino-World-*-all.jar` so they don't need
 * updating. The remaining version-pinned files are deployment templates the
 * operator copies and edits anyway: README.md (Production deploy layout) and
 * scripts/dinoworld.service (ExecStart line).
 */
plugins {
    java
    application
    id("com.gradleup.shadow") version "9.4.1"
}

group = "dev.homeology"
version = "1.0.0-beta1"

// ─── Dependency versions (single source of truth — edit here) ─────────────
val jdaVersion = "6.4.1"      // https://mvnrepository.com/artifact/net.dv8tion/JDA
val sqliteVersion = "3.53.1.0"   // https://mvnrepository.com/artifact/org.xerial/sqlite-jdbc
val hikariVersion = "7.0.2"      // https://mvnrepository.com/artifact/com.zaxxer/HikariCP
val caffeineVersion = "3.2.4"      // https://mvnrepository.com/artifact/com.github.ben-manes.caffeine/caffeine
val dotenvVersion = "3.2.0"      // https://mvnrepository.com/artifact/io.github.cdimascio/dotenv-java
val logbackVersion = "1.5.32"     // https://mvnrepository.com/artifact/ch.qos.logback/logback-classic
val micrometerVersion = "1.16.5"     // https://mvnrepository.com/artifact/io.micrometer/micrometer-core
val snakeyamlVersion = "2.6"        // https://mvnrepository.com/artifact/org.yaml/snakeyaml
val junitBomVersion = "6.0.3"      // https://mvnrepository.com/artifact/org.junit/junit-bom (latest stable)
val mockitoVersion = "5.23.0"     // https://mvnrepository.com/artifact/org.mockito/mockito-core
// ──────────────────────────────────────────────────────────────────────────

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(25)
    }
}

application {
    mainClass = "dev.homeology.dinoworld.Bootstrap"
}

// Embed the project version into the jar manifest so AboutCommand can read
// it at runtime via Package.getImplementationVersion() — keeps /about in
// sync with the version above without a separate constant to update.
tasks.jar {
    manifest {
        attributes("Implementation-Version" to project.version)
    }
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("net.dv8tion:JDA:$jdaVersion")
    implementation("org.xerial:sqlite-jdbc:$sqliteVersion")
    implementation("com.zaxxer:HikariCP:$hikariVersion")
    implementation("com.github.ben-manes.caffeine:caffeine:$caffeineVersion")
    implementation("io.github.cdimascio:dotenv-java:$dotenvVersion")
    implementation("ch.qos.logback:logback-classic:$logbackVersion")
    implementation("io.micrometer:micrometer-core:$micrometerVersion")
    implementation("org.yaml:snakeyaml:$snakeyamlVersion")

    testImplementation(platform("org.junit:junit-bom:$junitBomVersion"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testImplementation("org.mockito:mockito-core:$mockitoVersion")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test {
    useJUnitPlatform()
}

// Allow `./gradlew run` to read stdin so the bot can be Ctrl-C'd cleanly.
tasks.named<JavaExec>("run") {
    standardInput = System.`in`
}
