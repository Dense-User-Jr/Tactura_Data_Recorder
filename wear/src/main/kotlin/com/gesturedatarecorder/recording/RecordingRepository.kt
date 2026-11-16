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

    /** What the Listen screen can ask the service to do. */
    sealed interface ListenCommand {
        /** The user tapped [word]: it is the word they were spelling. */
        class Choose(val word: String) : ListenCommand

        /** Take back the last gesture. */
        object Undo : ListenCommand
    }

    private val _cursorAxis = MutableStateFlow(TiltCursor.Axis.NOD)

    /** Which tilt moves the word cursor in Listen mode. Kept until the app is closed. */
    val cursorAxis: StateFlow<TiltCursor.Axis> = _cursorAxis.asStateFlow()

    /** Switches the word cursor to the next way of tilting: nod, roll, off. */
    fun nextCursorAxis() = _cursorAxis.update { TiltCursor.Axis.entries[(it.ordinal + 1) % TiltCursor.Axis.entries.size] }

    private val _listenCommands = MutableSharedFlow<ListenCommand>(extraBufferCapacity = 4)

    /** Collected by a running [RecordingService] in Listen mode. */
    internal val listenCommands: SharedFlow<ListenCommand> = _listenCommands.asSharedFlow()

    internal fun update(transform: (RecordingStatus) -> RecordingStatus) = _status.update(transform)

    /** Listen mode: [word] is the word being spelled. Show it and start the next one. */
    fun chooseWord(word: String) {
        _listenCommands.tryEmit(ListenCommand.Choose(word))
    }

    /** Listen mode: take back the last gesture. */
    fun undoGesture() {
        _listenCommands.tryEmit(ListenCommand.Undo)
    }

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
