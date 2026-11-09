package com.gesturedatarecorder.recording

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * Process-wide state shared by [RecordingService] (writer) and the UI (reader).
 * Because it is a [StateFlow], a recreated activity immediately sees the true current state.
 */
object RecordingRepository {
    private val _status = MutableStateFlow(RecordingStatus())
    val status: StateFlow<RecordingStatus> = _status.asStateFlow()

    private val _cancelRequests = MutableSharedFlow<Unit>(extraBufferCapacity = 1)

    /** Collected by a running [RecordingService]; emissions with no service running are dropped. */
    internal val cancelRequests: SharedFlow<Unit> = _cancelRequests.asSharedFlow()

    internal fun update(transform: (RecordingStatus) -> RecordingStatus) = _status.update(transform)

    /** Cancels the running session, if any. Never starts the service. */
    fun requestCancel() {
        _cancelRequests.tryEmit(Unit)
    }

    /** Returns from a finished result or error screen to the idle screen. */
    fun dismissResult() = _status.update { current ->
        if (current.phase.isBusy) current else RecordingStatus(sessionTally = current.sessionTally)
    }

    /** Shows an error without involving the service (e.g. a missing permission). */
    fun reportError(message: String) = _status.update { current ->
        if (current.phase.isBusy) current
        else RecordingStatus(phase = RecordingPhase.ERROR, message = message, sessionTally = current.sessionTally)
    }
}
