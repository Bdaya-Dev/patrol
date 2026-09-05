// Modified by Bdaya-Dev from the original LeanCode Patrol source (Apache-2.0). See NOTICE.md.
package pl.leancode.patrol

import android.util.Log

object Logger {
    private const val TAG = "PatrolServer"

    fun e(msg: String) {
        Log.e(TAG, msg)
    }

    fun e(msg: String, tr: Throwable?) {
        Log.e(TAG, msg, tr)
    }

    fun w(msg: String) {
        Log.w(TAG, msg)
    }

    fun i(msg: String) {
        Log.i(TAG, msg)
    }

    fun d(msg: String) {
        Log.d(TAG, msg)
    }
}
