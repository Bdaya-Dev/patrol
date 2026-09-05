// Modified by Bdaya-Dev from the original LeanCode Patrol source (Apache-2.0). See NOTICE.md.
package pl.leancode.patrol

import android.app.Instrumentation
import android.app.UiAutomation
import android.content.Context
import android.content.Context.LOCATION_SERVICE
import android.content.Intent
import android.location.Location
import android.location.LocationManager
import android.location.provider.ProviderProperties
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import android.provider.Settings
import android.view.KeyEvent.KEYCODE_VOLUME_DOWN
import android.view.KeyEvent.KEYCODE_VOLUME_UP
import android.widget.AutoCompleteTextView
import android.widget.EditText
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.BySelector
import androidx.test.uiautomator.Configurator
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.UiObject
import androidx.test.uiautomator.UiObject2
import androidx.test.uiautomator.UiObjectNotFoundException
import androidx.test.uiautomator.UiSelector
import pl.leancode.patrol.contracts.Contracts.AndroidNativeView
import pl.leancode.patrol.contracts.Contracts.AndroidSelector
import pl.leancode.patrol.contracts.Contracts.KeyboardBehavior
import pl.leancode.patrol.contracts.Contracts.Notification
import pl.leancode.patrol.contracts.Contracts.Point2D
import pl.leancode.patrol.contracts.Contracts.Rectangle
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import kotlin.math.roundToInt
import pl.leancode.patrol.R.string as s

private fun fromUiObject2(obj: UiObject2): AndroidNativeView {
    val bounds = obj.visibleBounds
    val center = obj.visibleCenter

    return AndroidNativeView(
        className = obj.className,
        text = obj.text,
        contentDescription = obj.contentDescription,
        isFocused = obj.isFocused,
        isEnabled = obj.isEnabled,
        childCount = obj.childCount.toLong(),
        resourceName = obj.resourceName,
        applicationPackage = obj.applicationPackage,
        isCheckable = obj.isCheckable,
        isChecked = obj.isChecked,
        isClickable = obj.isClickable,
        isFocusable = obj.isFocusable,
        isLongClickable = obj.isLongClickable,
        isScrollable = obj.isScrollable,
        isSelected = obj.isSelected,
        visibleBounds = Rectangle(
            minX = bounds.left.toDouble(),
            minY = bounds.top.toDouble(),
            maxX = bounds.right.toDouble(),
            maxY = bounds.top.toDouble()
        ),
        visibleCenter = Point2D(
            x = center.x.toDouble(),
            y = center.y.toDouble()
        ),
        children = obj.children?.map { fromUiObject2(it) } ?: listOf()
    )
}

/** How long [Automator.startScreenRecording] waits for `screenrecord` to report its pid. */
private const val SCREEN_RECORDING_START_TIMEOUT_MILLIS = 5_000L

/** How long [Automator.startScreenRecording] watches a freshly started `screenrecord` for an immediate exit. */
private const val SCREEN_RECORDING_START_GRACE_MILLIS = 500L

/** How long [Automator.stopScreenRecording] waits for `screenrecord` to exit and finalize the container. */
private const val SCREEN_RECORDING_STOP_TIMEOUT_MILLIS = 10_000L

private const val SCREEN_RECORDING_POLL_INTERVAL_MILLIS = 100L

/** Prefix of the line the recorder wrapper prints with `screenrecord`'s exit status. */
private const val SCREEN_RECORDING_EXIT_MARKER = "__PATROL_EXIT__"

/** A still capture written to the device. */
data class ScreenshotResult(val path: String, val sizeBytes: Long)

/**
 * A screen recording written to the device.
 *
 * [durationMillis] and [frameCount] are read back from the MP4 itself, not from a
 * clock; [frameCount] is null on Android versions below 9, which cannot report it.
 */
data class ScreenRecordingResult(val path: String, val sizeBytes: Long, val durationMillis: Long, val frameCount: Long?)

class Automator private constructor() {
    private var timeoutMillis: Long = 10_000

    private lateinit var instrumentation: Instrumentation
    private lateinit var configurator: Configurator
    private lateinit var uiDevice: UiDevice
    private lateinit var targetContext: Context
    private lateinit var uiAutomation: UiAutomation

    private var mockLocationExecutor: ScheduledExecutorService? = null
    private var mockLocationTask: java.util.concurrent.ScheduledFuture<*>? = null

    @Volatile private var currentLatitude: Double = 0.0

    @Volatile private var currentLongitude: Double = 0.0

    fun initialize() {
        if (!this::instrumentation.isInitialized) {
            instrumentation = InstrumentationRegistry.getInstrumentation()
        }
        if (!this::targetContext.isInitialized) {
            targetContext = instrumentation.targetContext
        }
        if (!this::configurator.isInitialized) {
            configurator = Configurator.getInstance()
        }
        if (!this::uiDevice.isInitialized) {
            uiDevice = UiDevice.getInstance(instrumentation)
        }
        if (!this::uiAutomation.isInitialized) {
            uiAutomation = instrumentation.uiAutomation
        }
    }

    fun configure(waitForSelectorTimeout: Long) {
        timeoutMillis = waitForSelectorTimeout
        configurator.waitForSelectorTimeout = waitForSelectorTimeout
        configurator.waitForIdleTimeout = 5000
        configurator.keyInjectionDelay = 50

        configurator.uiAutomationFlags = UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES

        Logger.i("Timeout: $timeoutMillis ms")
        Logger.i("Android UiAutomator configuration:")
        Logger.i("\twaitForSelectorTimeout: ${configurator.waitForSelectorTimeout} ms")
        Logger.i("\twaitForIdleTimeout: ${configurator.waitForIdleTimeout} ms")
        Logger.i("\tkeyInjectionDelay: ${configurator.keyInjectionDelay} ms")
        Logger.i("\tactionAcknowledgmentTimeout: ${configurator.actionAcknowledgmentTimeout} ms")
        Logger.i("\tscrollAcknowledgmentTimeout: ${configurator.scrollAcknowledgmentTimeout} ms")
        Logger.i("\ttoolType: ${configurator.toolType}")
        Logger.i("\tuiAutomationFlags: ${configurator.uiAutomationFlags}")
    }

    private fun executeShellCommand(cmd: String) {
        uiDevice.executeShellCommand(cmd)
        delay()
    }

    private fun delay(ms: Long = 1000) = SystemClock.sleep(ms)

    // capture

    /**
     * Everything belonging to one `screenrecord` run.
     *
     * The recorder runs as the shell user through two small scripts in [scratchDir].
     * [innerScript] writes its own pid to [pidFile] and then `exec`s `screenrecord`,
     * so the pid on record is the recorder's and not a wrapper's. [outerScript] runs
     * the inner one with stderr redirected to [stderrFile] and echoes the exit status
     * behind [SCREEN_RECORDING_EXIT_MARKER] -- `UiDevice.executeShellCommand` returns
     * only stdout and discards both.
     */
    private class ScreenRecordingSession(val output: File, val scratchDir: File) {
        val pidFile = File(scratchDir, "screenrecord.pid")
        val stderrFile = File(scratchDir, "screenrecord.stderr")
        val innerScript = File(scratchDir, "screenrecord.sh")
        val outerScript = File(scratchDir, "wrapper.sh")

        lateinit var thread: Thread

        /** stdout of the wrapper once it has exited. Carries the exit-status marker. */
        @Volatile var stdout: String? = null

        /** Set when `executeShellCommand` itself threw, i.e. the wrapper could not be run at all. */
        @Volatile var failure: Throwable? = null

        val exitCode: Int?
            get() = stdout
                ?.lineSequence()
                ?.lastOrNull { it.startsWith(SCREEN_RECORDING_EXIT_MARKER) }
                ?.removePrefix(SCREEN_RECORDING_EXIT_MARKER)
                ?.trim()
                ?.toIntOrNull()

        fun pid(): Int? = runCatching { pidFile.readText().trim().toInt() }.getOrNull()

        fun stderr(): String = runCatching { stderrFile.readText().trim() }.getOrDefault("")

        fun deleteScratch() {
            scratchDir.deleteRecursively()
        }
    }

    private data class RecordingInfo(val durationMillis: Long, val frameCount: Long?)

    /** Guards [screenRecording]. The http4k server dispatches requests on a thread pool. */
    private val screenRecordingLock = Any()
    private var screenRecording: ScreenRecordingSession? = null

    private fun shellQuote(value: String) = "'" + value.replace("'", "'\\''") + "'"

    /**
     * Runs [script] as the shell user via `sh <file>` and returns its stdout.
     *
     * `UiDevice.executeShellCommand` hands its argument to `Runtime.exec(String)`,
     * which splits on whitespace and knows nothing about quoting, so a command line
     * carrying a quoted path cannot be passed to it directly. The script goes into a
     * file both this process and the shell user can reach, and `sh` does the parsing.
     */
    private fun runShellScript(name: String, script: String): String {
        val file = File(captureScratchRoot(), "$name-${System.nanoTime()}.sh")
        file.writeText(script)
        try {
            return uiDevice.executeShellCommand("sh ${file.absolutePath}")
        } finally {
            file.delete()
        }
    }

    /**
     * The only directory captures may be written to.
     *
     * The app's external files directory is writable both by this process (which
     * writes screenshots) and by the shell user (which `screenrecord` runs as), and
     * `adb pull` can read it without root. `/sdcard/foo.png`, by contrast, is not
     * writable by this process on current Android versions.
     */
    private fun captureRoot(): File =
        targetContext.getExternalFilesDir(null)
            ?: throw PatrolException("capture: the app's external files directory is unavailable (is shared storage mounted?)")

    private fun captureScratchRoot(): File = File(captureRoot(), ".patrol_capture").also { it.mkdirs() }

    private fun canonicalOrNormalized(file: File): File =
        runCatching { file.canonicalFile }.getOrElse { file.absoluteFile.normalize() }

    /**
     * Resolves [path] to a file inside [captureRoot], creating parent directories.
     *
     * A relative path is resolved against that directory. An absolute path must
     * already point inside it; anything else is refused rather than written to (or
     * deleted from), because the shell user this runs as can reach far more of the
     * device than a test should.
     */
    private fun resolveCapturePath(path: String, action: String): File {
        val root = canonicalOrNormalized(captureRoot())
        val candidate = if (File(path).isAbsolute) File(path) else File(root, path)
        val resolved = canonicalOrNormalized(candidate)
        if (!resolved.path.startsWith(root.path + File.separator)) {
            throw PatrolException(
                "$action(): $path resolves to ${resolved.path}, which is outside the app's external files " +
                    "directory ${root.path}. Pass a path relative to that directory, or an absolute path inside it."
            )
        }
        resolved.parentFile?.mkdirs()
        return resolved
    }

    /** Removes a previous capture at [file]. Silently reusing one would look exactly like fresh evidence. */
    private fun removeStaleCapture(file: File, action: String) {
        if (!file.exists()) {
            return
        }
        // A recording is written by the shell user; this process may not be allowed to unlink it.
        if (!file.delete() || file.exists()) {
            runShellScript("rm", "rm -f ${shellQuote(file.absolutePath)}\n")
        }
        if (file.exists()) {
            throw PatrolException("$action(): failed to remove the existing file at ${file.absolutePath}")
        }
    }

    fun takeScreenshot(path: String): ScreenshotResult {
        val file = resolveCapturePath(path, "takeScreenshot")
        removeStaleCapture(file, "takeScreenshot")

        if (!uiDevice.takeScreenshot(file)) {
            throw PatrolException("takeScreenshot(): the device failed to capture the screen to ${file.absolutePath}")
        }

        val sizeBytes = file.length()
        if (sizeBytes <= 0L) {
            throw PatrolException("takeScreenshot(): no image data was written to ${file.absolutePath} (size=$sizeBytes)")
        }
        if (!startsWithPngSignature(file)) {
            throw PatrolException("takeScreenshot(): ${file.absolutePath} is not a PNG file")
        }

        return ScreenshotResult(path = file.absolutePath, sizeBytes = sizeBytes)
    }

    private fun startsWithPngSignature(file: File): Boolean {
        val signature = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
        val head = ByteArray(signature.size)
        val read = file.inputStream().use { it.read(head) }
        return read == signature.size && head.contentEquals(signature)
    }

    /**
     * Starts `screenrecord` and returns once it is running. Returns the absolute output path.
     *
     * A recording that is still running from an earlier call -- typically a test that
     * failed between start and stop -- is stopped and logged first, so one leaked
     * recorder cannot make every later recording fail with "already running".
     */
    fun startScreenRecording(
        path: String,
        timeLimitSeconds: Long?,
        bitRate: Long?,
        width: Long?,
        height: Long?
    ): String = synchronized(screenRecordingLock) {
        abandonScreenRecordingLocked("startScreenRecording() was called again before it was stopped")

        val output = resolveCapturePath(path, "startScreenRecording")
        removeStaleCapture(output, "startScreenRecording")

        val scratch = File(captureScratchRoot(), "rec-${System.currentTimeMillis()}")
        if (!scratch.mkdirs() && !scratch.isDirectory) {
            throw PatrolException("startScreenRecording(): cannot create ${scratch.absolutePath}")
        }
        val session = ScreenRecordingSession(output = output, scratchDir = scratch)

        val cmd = StringBuilder("exec screenrecord")
        if (timeLimitSeconds != null) {
            cmd.append(" --time-limit ").append(timeLimitSeconds)
        }
        if (bitRate != null) {
            cmd.append(" --bit-rate ").append(bitRate)
        }
        if (width != null && height != null) {
            cmd.append(" --size ").append(width).append('x').append(height)
        }
        cmd.append(' ').append(shellQuote(output.absolutePath))

        session.innerScript.writeText("echo \$\$ > ${shellQuote(session.pidFile.absolutePath)}\n$cmd\n")
        session.outerScript.writeText(
            "sh ${shellQuote(session.innerScript.absolutePath)} 2>${shellQuote(session.stderrFile.absolutePath)}\n" +
                "echo \"$SCREEN_RECORDING_EXIT_MARKER\$?\"\n"
        )

        // `screenrecord` runs until interrupted, so it cannot be awaited here.
        val thread = Thread {
            try {
                session.stdout = uiDevice.executeShellCommand("sh ${session.outerScript.absolutePath}")
            } catch (e: Throwable) {
                session.failure = e
            }
        }
        thread.name = "patrol-screenrecord"
        thread.isDaemon = true
        session.thread = thread
        thread.start()

        // Fail fast rather than discover at stop(), after the whole flow has been
        // performed into nothing, that the recorder never ran. Note that the output
        // file is no signal here: screenrecord creates it lazily, on the first encoded
        // frame, which on a still screen can be never.
        val deadline = SystemClock.elapsedRealtime() + SCREEN_RECORDING_START_TIMEOUT_MILLIS
        var pid = session.pid()
        while (pid == null) {
            if (!thread.isAlive) {
                val why = describeRecorderExit(session)
                session.deleteScratch()
                throw PatrolException("startScreenRecording(): screenrecord exited before it started recording; $why")
            }
            if (SystemClock.elapsedRealtime() >= deadline) {
                signalScreenRecordProcess(session, "KILL")
                thread.join(1_000)
                val why = describeRecorderExit(session)
                session.deleteScratch()
                throw PatrolException(
                    "startScreenRecording(): screenrecord did not start within $SCREEN_RECORDING_START_TIMEOUT_MILLIS ms; $why"
                )
            }
            SystemClock.sleep(SCREEN_RECORDING_POLL_INTERVAL_MILLIS)
            pid = session.pid()
        }

        // A screenrecord that rejects its arguments or cannot open its output exits
        // within milliseconds of starting. Wait that long so such a failure surfaces
        // here, with its stderr, instead of as a mysterious empty file later.
        thread.join(SCREEN_RECORDING_START_GRACE_MILLIS)
        if (!thread.isAlive) {
            val why = describeRecorderExit(session)
            session.deleteScratch()
            throw PatrolException("startScreenRecording(): screenrecord exited immediately; $why")
        }

        screenRecording = session
        Logger.i("startScreenRecording(): screenrecord (pid $pid) is recording to ${output.absolutePath}")
        output.absolutePath
    }

    fun stopScreenRecording(): ScreenRecordingResult = synchronized(screenRecordingLock) {
        val session = screenRecording ?: throw PatrolException("stopScreenRecording(): no recording is running")
        screenRecording = null
        finishScreenRecording(session)
    }

    /**
     * Stops a recording that is still running at a test boundary, logging why.
     *
     * [Automator] is a process-wide singleton that outlives every Dart test, so a
     * recorder leaked by a test that failed between start and stop would otherwise keep
     * recording, and fail every later start. Never throws: cleanup must not mask the
     * failure that caused it.
     */
    fun abandonStaleScreenRecording(reason: String) = synchronized(screenRecordingLock) {
        abandonScreenRecordingLocked(reason)
    }

    private fun abandonScreenRecordingLocked(reason: String) {
        val session = screenRecording ?: return
        screenRecording = null
        Logger.w("Abandoning the screen recording of ${session.output.absolutePath}: $reason")
        try {
            val result = finishScreenRecording(session)
            Logger.w(
                "The abandoned recording ${result.path} was finalized anyway " +
                    "(${result.sizeBytes} bytes, ${result.durationMillis} ms)"
            )
        } catch (e: Exception) {
            Logger.w("The abandoned recording could not be finalized: ${e.message}")
        }
    }

    /**
     * Interrupts the recorder, waits for it to exit, and validates what it left behind.
     *
     * Every failure throws. A recording that quietly produced nothing is worse than no
     * recording, because the artifact is the evidence: a broken recorder does not look
     * broken, it looks like proof.
     */
    private fun finishScreenRecording(session: ScreenRecordingSession): ScreenRecordingResult {
        val path = session.output.absolutePath
        try {
            // SIGINT, never SIGKILL: screenrecord writes the MP4 `moov` index as it shuts
            // down. A killed process leaves a file of the very same byte size that no
            // player can open.
            signalScreenRecordProcess(session, "INT")
            session.thread.join(SCREEN_RECORDING_STOP_TIMEOUT_MILLIS)
            if (session.thread.isAlive) {
                signalScreenRecordProcess(session, "KILL")
                session.thread.join(2_000)
                throw PatrolException(
                    "stopScreenRecording(): screenrecord did not exit within $SCREEN_RECORDING_STOP_TIMEOUT_MILLIS ms " +
                        "of SIGINT and was killed, so $path is not playable"
                )
            }

            session.failure?.let {
                throw PatrolException("stopScreenRecording(): screenrecord could not be run: ${it.message}")
            }
            val exitCode = session.exitCode
                ?: throw PatrolException(
                    "stopScreenRecording(): screenrecord did not report an exit status " +
                        "(wrapper output: ${session.stdout?.trim()})"
                )
            val sizeBytes = session.output.length()
            if (exitCode != 0) {
                throw PatrolException(
                    "stopScreenRecording(): screenrecord exited with status $exitCode " +
                        "(${describeNonZeroExit(exitCode, session.stderr(), sizeBytes)}), so $path is not a valid recording"
                )
            }
            if (sizeBytes <= 0L) {
                throw PatrolException("stopScreenRecording(): no video was written to $path (size=$sizeBytes)")
            }

            // screenrecord creates its output owner-only (0600) as the shell user. This
            // process reaches the app's external files directory through the ext_data_rw
            // group, so the file is stat-able but not readable until the shell opens the
            // group bits -- measured on API 35: the wrapper's 0660 pid file reads fine, the
            // 0600 MP4 fails with EACCES. Do it here, so both the validation below and the
            // test that asked for the recording can read it.
            runShellScript("chmod", "chmod 0660 ${shellQuote(path)}\n")
            if (!session.output.canRead()) {
                throw PatrolException(
                    "stopScreenRecording(): $path was written by the shell user but is not readable by the app " +
                        "process, so it cannot be validated (ls -l: ${runShellScript("ls", "ls -l ${shellQuote(path)}\n").trim()})"
                )
            }

            val info = inspectRecording(session.output)
            return ScreenRecordingResult(
                path = path,
                sizeBytes = sizeBytes,
                durationMillis = info.durationMillis,
                frameCount = info.frameCount
            )
        } finally {
            session.deleteScratch()
        }
    }

    private fun describeRecorderExit(session: ScreenRecordingSession): String {
        session.failure?.let { return "the shell command could not be run: ${it.message}" }
        val exitCode = session.exitCode ?: return "no exit status was reported (wrapper output: ${session.stdout?.trim()})"
        return "exit status $exitCode (${describeNonZeroExit(exitCode, session.stderr(), session.output.length())})"
    }

    private fun describeNonZeroExit(exitCode: Int, stderr: String, sizeBytes: Long): String = when {
        stderr.isNotEmpty() -> stderr
        exitCode > 128 -> "killed by signal ${exitCode - 128}"
        sizeBytes <= 0L -> "no frames were captured; nothing on screen changed between start and stop"
        else -> "no diagnostic output"
    }

    /**
     * Sends [signal] to the recorder this session started -- and only to it.
     *
     * The pid comes from the pid file the inner script wrote, and is signalled only
     * while `/proc/<pid>/cmdline` still names `screenrecord`, so a recycled pid is
     * never hit. `pkill screenrecord` would be device-wide and take down recorders
     * this test did not start.
     */
    private fun signalScreenRecordProcess(session: ScreenRecordingSession, signal: String) {
        val pidFile = shellQuote(session.pidFile.absolutePath)
        val script = """
            pid=$(cat $pidFile 2>/dev/null)
            if [ -z "${'$'}pid" ]; then echo "no pid recorded"; exit 0; fi
            case "$(cat /proc/${'$'}pid/cmdline 2>/dev/null)" in
              *screenrecord*) kill -$signal "${'$'}pid" && echo "sent SIG$signal to ${'$'}pid" ;;
              *) echo "pid ${'$'}pid is no longer screenrecord" ;;
            esac
        """.trimIndent() + "\n"
        val out = runShellScript("signal", script).trim()
        Logger.i("screenrecord SIG$signal: $out")
    }

    /** Reads the finished MP4 and throws unless it is something a player could open. */
    private fun inspectRecording(file: File): RecordingInfo {
        val path = file.absolutePath

        val boxes = topLevelMp4Boxes(file)
        if ("moov" !in boxes) {
            throw PatrolException(
                "stopScreenRecording(): $path is not a playable MP4: it has no moov box (top-level boxes: $boxes). " +
                    "screenrecord writes that index only when it exits cleanly."
            )
        }

        val retriever = MediaMetadataRetriever()
        try {
            try {
                retriever.setDataSource(path)
            } catch (e: Exception) {
                throw PatrolException("stopScreenRecording(): the media framework cannot open $path: ${e.message}")
            }
            if (retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_VIDEO) != "yes") {
                throw PatrolException("stopScreenRecording(): $path has no video track")
            }
            val durationMillis = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
            val frameCount = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_FRAME_COUNT)?.toLongOrNull()
            } else {
                null
            }
            if (frameCount == 0L) {
                throw PatrolException("stopScreenRecording(): $path contains no video frames")
            }
            return RecordingInfo(durationMillis = durationMillis, frameCount = frameCount)
        } finally {
            retriever.release()
        }
    }

    /** Types of the top-level boxes of an ISO base media (MP4) file, in file order. */
    private fun topLevelMp4Boxes(file: File): List<String> {
        val boxes = mutableListOf<String>()
        RandomAccessFile(file, "r").use { raf ->
            val length = raf.length()
            val header = ByteArray(8)
            var offset = 0L
            while (offset + header.size <= length && boxes.size < 64) {
                raf.seek(offset)
                raf.readFully(header)
                var size = ByteBuffer.wrap(header, 0, 4).int.toLong() and 0xFFFFFFFFL
                val type = String(header, 4, 4, Charsets.ISO_8859_1)
                if (size == 1L) {
                    size = raf.readLong() // 64-bit "largesize" follows the header
                } else if (size == 0L) {
                    size = length - offset // box extends to the end of the file
                }
                if (size < header.size) {
                    break
                }
                boxes.add(type)
                offset += size
            }
        }
        return boxes
    }

    fun openApp(packageName: String) {
        val intent = targetContext.packageManager!!.getLaunchIntentForPackage(packageName)
            ?: throw Exception("intent for launching package \"$packageName\" is null. Make sure you have android.permission.QUERY_ALL_PACKAGES in AndroidManifest.xml")
        // intent?.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK) // clear out any previous task, i.e., make sure it starts on the initial screen
        targetContext.startActivity(intent) // starts the app
        delay()
    }

    fun openUrl(urlString: String) {
        Logger.d("openUrl($urlString)")
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(urlString))
        intent.addCategory(Intent.CATEGORY_BROWSABLE)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        targetContext.startActivity(intent)
        delay()
    }

    fun pressBack() {
        Logger.d("pressBack()")
        uiDevice.pressBack()
        delay()
    }

    fun pressHome() {
        Logger.d("pressHome()")
        uiDevice.pressHome()
        delay()
    }

    fun pressRecentApps() {
        Logger.d("pressRecentApps()")
        uiDevice.pressRecentApps()
        delay()
    }

    fun pressDoubleRecentApps() {
        Logger.d("pressDoubleRecentApps()")

        uiDevice.pressRecentApps()
        delay()
        uiDevice.pressRecentApps()
        delay()
    }

    fun enableDarkMode() = executeShellCommand("cmd uimode night yes")

    fun disableDarkMode() = executeShellCommand("cmd uimode night no")

    fun enableAirplaneMode() {
        val enabled = isAirplaneModeOn()
        if (enabled) {
            Logger.d("Airplane mode already enabled")
            return
        }
        Logger.d("Enabling airplane mode")
        toggleAirplaneMode()
    }

    fun disableAirplaneMode() {
        val enabled = isAirplaneModeOn()
        if (!enabled) {
            Logger.d("Airplane mode already disabled")
            return
        }
        Logger.d("Disabling airplane mode")
        toggleAirplaneMode()
    }

    fun disableCellular() = executeShellCommand("svc data disable")

    fun enableCellular() = executeShellCommand("svc data enable")

    fun disableWifi() = executeShellCommand("svc wifi disable")

    fun enableWifi() = executeShellCommand("svc wifi enable")

    fun enableBluetooth() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            executeShellCommand("svc bluetooth enable")
        } else {
            throw PatrolException("enableBluetooth method is not available in Android lower than 12")
        }
    }

    fun disableBluetooth() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            executeShellCommand("svc bluetooth disable")
        } else {
            throw PatrolException("disableBluetooth method is not available in Android lower than 12")
        }
    }

    fun enableLocation() {
        val enabled = isLocationEnabled()
        if (enabled) {
            Logger.d("Location already enabled")
            return
        } else {
            toggleLocation()
        }
    }

    fun disableLocation() {
        val enabled = isLocationEnabled()
        if (!enabled) {
            Logger.d("Location already disabled")
            return
        } else {
            toggleLocation()
        }
    }

    private fun isLocationEnabled(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            // This is a new method provided in API 28
            val lm = targetContext.getSystemService(Context.LOCATION_SERVICE) as LocationManager
            lm.isLocationEnabled
        } else {
            // This was deprecated in API 28
            val mode = Settings.Secure.getInt(
                targetContext.contentResolver,
                Settings.Secure.LOCATION_MODE,
                Settings.Secure.LOCATION_MODE_OFF
            )
            mode != Settings.Secure.LOCATION_MODE_OFF
        }
    }

    fun getNativeViews(selector: BySelector): List<AndroidNativeView> {
        Logger.d("getNativeViewsV2()")

        val uiObjects2 = uiDevice.findObjects(selector)
        return uiObjects2.map { fromUiObject2(it) }
    }

    fun getNativeUITrees(): List<AndroidNativeView> {
        Logger.d("getNativeUITrees()")

        return getWindowTrees(uiDevice, uiAutomation)
    }

    fun tap(uiSelector: UiSelector, bySelector: BySelector, index: Int, timeout: Long? = null) {
        Logger.d("tap(): $uiSelector, $bySelector")

        if (waitForView(bySelector, index, timeout) == null) {
            throw UiObjectNotFoundException("$uiSelector")
        }

        val uiObject = uiDevice.findObject(uiSelector)
        Logger.d("Clicking on UIObject with text: ${uiObject.text}")
        uiObject.click()
        delay()
    }

    fun doubleTap(
        uiSelector: UiSelector,
        bySelector: BySelector,
        index: Int,
        timeout: Long? = null,
        delayBetweenTaps: Long? = null
    ) {
        Logger.d("doubleTap(): $uiSelector, $bySelector")

        val uiObject = uiDevice.findObject(uiSelector)

        if (waitForView(bySelector, index, timeout) == null) {
            throw UiObjectNotFoundException("$uiSelector")
        }

        Logger.d("Performing double tap on UIObject with text: ${uiObject.text}")

        // Get the bounds of the UI element
        val rect = uiObject.bounds
        // Calculate the center point
        val centerX = rect.centerX()
        val centerY = rect.centerY()

        // Perform double click at the center
        Logger.d("After first click")

        uiDevice.click(centerX, centerY)

        // Customizable Delay between taps
        delay(ms = delayBetweenTaps ?: 300)

        Logger.d("After second click")
        uiDevice.click(centerX, centerY)
    }

    fun tapAt(x: Float, y: Float) {
        Logger.d("tapAt(x: $x, y: $y)")

        if (x !in 0f..1f) {
            throw IllegalArgumentException("x represents a percentage and must be between 0 and 1")
        }

        if (y !in 0f..1f) {
            throw IllegalArgumentException("y represents a percentage and must be between 0 and 1")
        }

        val displayX = (uiDevice.displayWidth * x).roundToInt()
        val displayY = (uiDevice.displayHeight * y).roundToInt()

        Logger.d("Clicking at display location (pixels) [$displayX, $displayY]")

        val successful = uiDevice.click(displayX, displayY)

        if (!successful) {
            throw IllegalArgumentException("Clicking at location [$displayX, $displayY] failed")
        }

        delay()
    }

    fun enterText(
        text: String,
        index: Int,
        keyboardBehavior: KeyboardBehavior,
        timeout: Long? = null,
        dx: Float,
        dy: Float
    ) {
        Logger.d("enterText(text: $text, index: $index)")

        val selector = By.clazz(EditText::class.java)
        if (waitForView(selector, index, timeout) == null) {
            throw UiObjectNotFoundException("$selector")
        }

        Logger.d("entering text \"$text\" to EditText at index $index")

        val uiSelector = UiSelector().className(EditText::class.java).instance(index)
        val uiObject = uiDevice.findObject(uiSelector)

        if (keyboardBehavior == KeyboardBehavior.showAndDismiss) {
            val rect = uiObject.visibleBounds
            val x = rect.left + rect.width() * dx
            val y = rect.top + rect.height() * dy
            uiDevice.click(x.toInt(), y.toInt())
        }

        uiObject.setText(text)

        if (keyboardBehavior == KeyboardBehavior.showAndDismiss) {
            pressBack() // Hide keyboard.
        }
    }

    fun enterText(
        text: String,
        uiSelector: UiSelector,
        bySelector: BySelector,
        index: Int,
        keyboardBehavior: KeyboardBehavior,
        timeout: Long? = null,
        dx: Float,
        dy: Float
    ) {
        Logger.d("enterText($text): $uiSelector, $bySelector")

        if (waitForView(bySelector, index, timeout) == null) {
            throw UiObjectNotFoundException("$uiSelector")
        }

        var uiObject = uiDevice.findObject(uiSelector)
        val uiObjectClassName = uiObject.getClassName()

        val supportedClassNames = setOf(
            EditText::class.java.name,
            AutoCompleteTextView::class.java.name
        )

        if (uiObjectClassName !in supportedClassNames) {
            var hasSupportedChild = false
            for (supportedClassName in supportedClassNames) {
                try {
                    uiObject = uiObject.getChild(UiSelector().className(supportedClassName))
                    hasSupportedChild = true
                    break
                } catch (e: UiObjectNotFoundException) {
                    // skip and try next
                }
            }

            if (!hasSupportedChild) {
                throw UiObjectNotFoundException("Could not find any supported child for $uiSelector")
            }
        }

        if (keyboardBehavior == KeyboardBehavior.showAndDismiss) {
            val rect = uiObject.visibleBounds
            val x = rect.left + rect.width() * dx
            val y = rect.top + rect.height() * dy
            uiDevice.click(x.toInt(), y.toInt())
        }

        uiObject.setText(text)

        if (keyboardBehavior == KeyboardBehavior.showAndDismiss) {
            pressBack() // Hide keyboard.
        }
    }

    fun swipe(startX: Float, startY: Float, endX: Float, endY: Float, steps: Int) {
        Logger.d("swipe(startX: $startX, startY: $startY, endX: $endX, endY: $endY, steps: $steps)")

        if (startX !in 0f..1f) {
            throw IllegalArgumentException("startX represents a percentage and must be between 0 and 1")
        }

        if (startY !in 0f..1f) {
            throw IllegalArgumentException("startY represents a percentage and must be between 0 and 1")
        }

        if (endX !in 0f..1f) {
            throw IllegalArgumentException("endX represents a percentage and must be between 0 and 1")
        }

        if (endY !in 0f..1f) {
            throw IllegalArgumentException("endY represents a percentage and must be between 0 and 1")
        }

        val sX = (uiDevice.displayWidth * startX).roundToInt()
        val sY = (uiDevice.displayHeight * startY).roundToInt()
        val eX = (uiDevice.displayWidth * endX).roundToInt()
        val eY = (uiDevice.displayHeight * endY).roundToInt()

        val successful = uiDevice.swipe(sX, sY, eX, eY, steps)

        if (!successful) {
            throw IllegalArgumentException("Swipe failed")
        }

        delay()
    }

    fun waitUntilVisible(
        uiSelector: UiSelector,
        bySelector: BySelector,
        index: Int,
        timeout: Long? = null
    ) {
        Logger.d("waitUntilVisible(): $uiSelector, $bySelector")

        if (waitForView(bySelector, index, timeout) == null) {
            throw UiObjectNotFoundException("$uiSelector")
        }
    }

    fun pressVolumeUp() {
        Logger.d("pressVolumeUp")
        val success = uiDevice.pressKeyCode(KEYCODE_VOLUME_UP)
        if (!success) {
            throw PatrolException("Could not press volume up")
        }
        delay()
    }

    fun pressVolumeDown() {
        Logger.d("pressVolumeDown")
        val success = uiDevice.pressKeyCode(KEYCODE_VOLUME_DOWN)
        if (!success) {
            throw PatrolException("Could not press volume down")
        }
        delay()
    }

    fun openNotifications() {
        Logger.d("openNotifications()")
        val success = uiDevice.openNotification()
        if (!success) {
            throw PatrolException("Could not open notifications")
        }
        delay()
    }

    fun closeNotifications() {
        Logger.d("closeNotifications()")
        val success = uiDevice.pressBack()
        if (!success) {
            throw PatrolException("Could not close notifications")
        }
        delay()
    }

    fun openQuickSettings() {
        Logger.d("openNotifications()")
        val success = uiDevice.openQuickSettings()
        if (!success) {
            throw PatrolException("Could not open quick settings")
        }
        delay()
    }

    fun sendKeyboardEnter() {
        Logger.d("sendKeyboardEnter()")
        val success = uiDevice.pressEnter()
        if (!success) {
            throw PatrolException("Could not send keyboard enter")
        }
        delay()
    }

    fun getNotifications(): List<Notification> {
        Logger.d("getNotifications()")

        val notificationContainers = mutableListOf<UiObject2>()
        val identifiers = listOf(
            "android:id/status_bar_latest_event_content", // notification not bundled
            "com.android.systemui:id/expandableNotificationRow" // notifications bundled
        )

        for (identifier in identifiers) {
            val objects = uiDevice.findObjects(By.res(identifier))
            if (identifier == "com.android.systemui:id/expandableNotificationRow") {
                // the first element is invalid
                objects.removeFirstOrNull()
            }

            Logger.i("Found ${objects.size} notification containers with resourceId \"$identifier\"")
            notificationContainers.addAll(objects)
        }

        Logger.d("Found ${notificationContainers.size} notifications")

        val notifications = mutableListOf<Notification>()
        for (notificationContainer in notificationContainers) {
            val appName = notificationContainer.findObject(By.res("android:id/app_name_text"))?.text

            val content = notificationContainer.findObject(By.res("android:id/text"))?.text
                ?: notificationContainer.findObject(By.res("android:id/big_text"))?.text
                ?: notificationContainer.findObject(By.res("com.android.systemui:id/notification_text"))?.text
            if (content == null) {
                Logger.e("Could not find content text")
            }

            val title = notificationContainer.findObject(By.res("android:id/title"))?.text
                ?: notificationContainer.findObject(By.res("com.android.systemui:id/notification_title"))?.text
            if (title == null) {
                Logger.e("Could not find title text")
            }

            val notification = Notification(
                appName = appName,
                content = content ?: "",
                title = title ?: ""
            )

            notifications.add(notification)
        }

        return notifications
    }

    fun tapOnNotification(index: Int, timeout: Long? = null) {
        Logger.d("tapOnNotificationV2($index)")

        try {
            val queryForBySelector = AndroidSelector(
                resourceName = "android:id/status_bar_latest_event_content"
            )
            val selector = queryForBySelector.toBySelector()
            if (waitForView(selector, index, timeout) == null) {
                throw UiObjectNotFoundException("$selector")
            }
            val queryForUiSelector = AndroidSelector(
                resourceName = "android:id/status_bar_latest_event_content",
                instance = index.toLong()
            )
            val obj = uiDevice.findObject(queryForUiSelector.toUiSelector())
            obj.click()
        } catch (err: UiObjectNotFoundException) {
            throw UiObjectNotFoundException("notification at index $index")
        }

        delay()
    }

    fun tapOnNotification(selector: UiSelector, bySelector: BySelector, timeout: Long? = null) {
        Logger.d("tapOnNotification()")

        if (waitForView(bySelector, 0, timeout) == null) {
            throw UiObjectNotFoundException("$bySelector")
        }
        val obj = uiDevice.findObject(selector)
        obj.click()

        delay()
    }

    fun isPermissionDialogVisible(timeout: Long): Boolean {
        val identifiers = arrayOf(
            // while using
            "com.android.packageinstaller:id/permission_allow_button",
            "com.android.permissioncontroller:id/permission_allow_button",
            "com.android.permissioncontroller:id/permission_allow_foreground_only_button",
            // once
            "com.android.packageinstaller:id/permission_allow_button",
            "com.android.permissioncontroller:id/permission_allow_button",
            "com.android.permissioncontroller:id/permission_allow_one_time_button",
            // deny
            "com.android.packageinstaller:id/permission_deny_button",
            "com.android.permissioncontroller:id/permission_deny_button",
            "com.android.permissioncontroller:id/permission_deny_and_dont_ask_again_button"
        )

        val uiObject = waitForUiObjectByResourceId(*identifiers, timeout = timeout)
        return uiObject != null
    }

    fun allowPermissionWhileUsingApp() {
        val identifiers = arrayOf(
            "com.android.packageinstaller:id/permission_allow_button", // API <= 28
            "com.android.permissioncontroller:id/permission_allow_button", // API 29
            "com.android.permissioncontroller:id/permission_allow_foreground_only_button", // API >= 30 + API 29 (only for location permission)
            "com.android.permissioncontroller:id/permission_allow_all_button" // for gallery permission
        )

        val uiObject = waitForUiObjectByResourceId(*identifiers, timeout = timeoutMillis)
            ?: throw UiObjectNotFoundException("button to allow permission while using")

        uiObject.click()
    }

    fun allowPermissionOnce() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            // One-time permissions are available only on API 30 (R) and above.
            // See: https://developer.android.com/training/permissions/requesting#one-time
            allowPermissionWhileUsingApp()
            return
        }

        val identifiers = arrayOf(
            "com.android.permissioncontroller:id/permission_allow_one_time_button", // API >= 30
            "com.android.permissioncontroller:id/permission_allow_button" // only for files & gallery permission
        )

        val uiObject = waitForUiObjectByResourceId(*identifiers, timeout = timeoutMillis)
            ?: throw UiObjectNotFoundException("button to allow permission once")

        uiObject.click()
    }

    fun denyPermission() {
        val identifiers = arrayOf(
            "com.android.packageinstaller:id/permission_deny_button", // API <= 28
            "com.android.permissioncontroller:id/permission_deny_button", // API >= 29 (first invocation)
            "com.android.permissioncontroller:id/permission_deny_and_dont_ask_again_button", // API >= 29 (second invocation)
            "android:id/button2" // for battery permission
        )

        val uiObject = waitForUiObjectByResourceId(*identifiers, timeout = timeoutMillis)
            ?: throw UiObjectNotFoundException("button to deny permission")

        uiObject.click()
    }

    fun allowPermission() {
        val resourceId = "android:id/button1"
        val uiObject = waitForUiObjectByResourceId(resourceId, timeout = timeoutMillis)
            ?: throw UiObjectNotFoundException("button to allow permission")
        uiObject.click()
    }

    fun selectFineLocation() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            Logger.i("Ignoring selectFineLocation() since it's not available on ${Build.VERSION.SDK_INT}")
            return
        }

        val resourceId =
            "com.android.permissioncontroller:id/permission_location_accuracy_radio_fine"

        val uiObject = waitForUiObjectByResourceId(resourceId, timeout = timeoutMillis)
            ?: throw UiObjectNotFoundException("button to select fine location")

        uiObject.click()
    }

    fun selectCoarseLocation() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            Logger.i("Ignoring selectFineLocation() since it's not available on ${Build.VERSION.SDK_INT}")
            return
        }

        val resourceId =
            "com.android.permissioncontroller:id/permission_location_accuracy_radio_coarse"

        val uiObject = waitForUiObjectByResourceId(resourceId, timeout = timeoutMillis)
            ?: throw UiObjectNotFoundException("button to select coarse location")

        uiObject.click()
    }

    fun setMockLocation(latitude: Double, longitude: Double, packageName: String) {
        currentLatitude = latitude
        currentLongitude = longitude

        executeShellCommand("appops set $packageName android:mock_location allow")
        val locationManager = targetContext.getSystemService(LOCATION_SERVICE) as LocationManager

        val mockLocationProvider = LocationManager.GPS_PROVIDER

        try {
            locationManager.removeTestProvider(mockLocationProvider)
            Logger.d("Removed existing test provider")
        } catch (e: Exception) {
            Logger.d("No existing test provider to remove")
        }

        locationManager.addTestProvider(
            mockLocationProvider,
            false,
            false,
            false,
            false,
            true,
            true,
            true,
            ProviderProperties.POWER_USAGE_LOW,
            ProviderProperties.ACCURACY_FINE
        )

        locationManager.setTestProviderEnabled(mockLocationProvider, true)

        // Cancel any existing scheduled task
        mockLocationTask?.cancel(false)

        if (mockLocationExecutor == null) {
            mockLocationExecutor = Executors.newSingleThreadScheduledExecutor()
        }

        mockLocationTask = mockLocationExecutor?.scheduleAtFixedRate({
            try {
                val mockLocation = Location(mockLocationProvider)
                mockLocation.latitude = currentLatitude
                mockLocation.longitude = currentLongitude
                mockLocation.altitude = 0.0
                mockLocation.accuracy = 1.0f
                mockLocation.time = System.currentTimeMillis()
                mockLocation.elapsedRealtimeNanos = SystemClock.elapsedRealtimeNanos()

                locationManager.setTestProviderLocation(mockLocationProvider, mockLocation)
            } catch (e: Exception) {
                Logger.e("Error updating mock location: ${e.message}")
            }
        }, 0, 500, TimeUnit.MILLISECONDS)
    }

    fun stopMockLocation() {
        mockLocationTask?.cancel(false)
        mockLocationTask = null
        mockLocationExecutor?.shutdown()
        mockLocationExecutor = null

        try {
            val locationManager = targetContext.getSystemService(LOCATION_SERVICE) as LocationManager
            locationManager.removeTestProvider(LocationManager.GPS_PROVIDER)
            Logger.d("Mock location stopped and provider removed")
        } catch (e: Exception) {
            Logger.e("Error stopping mock location: ${e.message}")
        }
    }

    fun takeCameraPhoto(shutterButtonUiSelector: UiSelector, shutterButtonBySelector: BySelector, doneButtonUiSelector: UiSelector, doneButtonBySelector: BySelector, timeout: Long? = null) {
        if (isPermissionDialogVisible(timeout = AutomatorConstants.PERMISSION_DIALOG_WAIT_TIMEOUT)) {
            allowPermissionWhileUsingApp()
        }
        tap(shutterButtonUiSelector, shutterButtonBySelector, 0, timeout)

        // Try to tap done button, if not visible try Google Camera shutter button fallback
        val doneButton = waitForView(doneButtonBySelector, 0, timeout)
        if (doneButton != null) {
            Logger.d("Done button found, tapping it")
            doneButton.click()
            delay()
        } else {
            Logger.d("Done button not visible, trying fallback: Google Camera shutter button")
            val fallbackBySelector = By.res(AutomatorConstants.GOOGLE_CAMERA_SHUTTER_BUTTON_RES_ID)
            val fallbackButton = waitForView(fallbackBySelector, 0, timeout)
            if (fallbackButton != null) {
                Logger.d("Fallback button found, tapping it")
                fallbackButton.click()
                delay()
            } else {
                Logger.e("Neither done button nor fallback button found")
                throw PatrolException("takeCameraPhoto(): neither done button nor Google Camera shutter button found")
            }
        }
    }

    fun pickImageFromGallery(imageUiSelector: UiSelector, imageBySelector: BySelector, subMenuUiSelector: UiSelector?, subMenuBySelector: BySelector?, actionMenuUiSelector: UiSelector?, actionMenuBySelector: BySelector?, instance: Int, timeout: Long? = null) {
        if (subMenuBySelector != null && subMenuUiSelector != null) {
            tap(subMenuUiSelector, subMenuBySelector, 0)
        }
        tap(imageUiSelector, imageBySelector, instance.toInt())
        if (actionMenuBySelector != null && actionMenuUiSelector != null) {
            tap(actionMenuUiSelector, actionMenuBySelector, 0)
        }
    }

    fun pickMultipleImagesFromGallery(imageUiSelector: UiSelector, imageBySelector: BySelector, subMenuUiSelector: UiSelector?, subMenuBySelector: BySelector?, actionMenuUiSelector: UiSelector, actionMenuBySelector: BySelector, imageIndexes: List<Long>, timeout: Long? = null) {
        // For API level 33 and below, we need to change type of the list
        // to be able to select multiple images with taps instead of long press
        if (subMenuBySelector != null && subMenuUiSelector != null) {
            tap(subMenuUiSelector, subMenuBySelector, 0, timeout)
        }

        // Tap on multiple images
        for (i in imageIndexes) {
            val image = i.toInt()
            val imageUiSelectorWithInstance = imageUiSelector.instance(image)
            tap(imageUiSelectorWithInstance, imageBySelector, image, timeout)
        }

        tap(actionMenuUiSelector, actionMenuBySelector, 0, timeout)
    }

    /**
     * Returns true if [bySelector] found a view at [index] within [timeoutMillis], false otherwise.
     */
    private fun waitForView(bySelector: BySelector, index: Int, timeout: Long? = null): UiObject2? {
        val startTime = System.currentTimeMillis()
        while (System.currentTimeMillis() - startTime < (timeout ?: timeoutMillis)) {
            val objects = uiDevice.findObjects(bySelector)
            if (objects.size > index && objects[index] != null) {
                return objects[index]
            }

            delay(ms = 500)
        }

        return null
    }

    private fun waitForUiObjectByResourceId(vararg identifiers: String, timeout: Long): UiObject? {
        val startTime = System.currentTimeMillis()
        while (System.currentTimeMillis() - startTime < timeout) {
            for (ident in identifiers) {
                val bySelector = By.res(ident)
                if (uiDevice.findObjects(bySelector).isNotEmpty()) {
                    return uiDevice.findObject(UiSelector().resourceId(ident))
                }
            }

            delay(ms = 500)
        }

        return null
    }

    private fun isAirplaneModeOn(): Boolean {
        return Settings.System.getInt(
            targetContext.contentResolver,
            Settings.Global.AIRPLANE_MODE_ON,
            0
        ) != 0
    }

    private fun toggleAirplaneMode() {
        val intent = Intent(Settings.ACTION_AIRPLANE_MODE_SETTINGS)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        targetContext.startActivity(intent)

        var uiSelector = UiSelector()
        uiSelector = uiSelector.text(Localization.getLocalizedString(targetContext, s.airplane_mode))
        val uiObject = uiDevice.findObject(uiSelector)
        if (uiObject != null) {
            uiObject.click()
            pressBack()
            delay()
        } else {
            throw PatrolException("Could not find airplane mode toggle")
        }
    }

    private fun toggleLocation() {
        val intent = Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        targetContext.startActivity(intent)

        var uiSelector = UiSelector()
        uiSelector = uiSelector.text(
            Localization.getLocalizedString(
                targetContext,
                s.use_location
            )
        )
        val uiObject = uiDevice.findObject(uiSelector)
        if (uiObject != null) {
            uiObject.click()
            pressBack()
            delay()
        } else {
            throw PatrolException("Could not find location toggle")
        }
    }

    companion object {
        val instance = Automator()
    }
}
