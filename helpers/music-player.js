const EventEmitter = require('events');
const ytdl = require('ytdl-core');

module.exports = class MusicPlayer extends EventEmitter
{
    constructor()
    {
        super();
        this._queue = new Map();
        this._state = new Map();
        this.searches = new Map();
    }

    /**
     *
     * @param guild
     * @returns {*}
     */
    getMusicQueue(guild)
    {
        let queue = this._queue.get(guild.id);
        if (queue) return queue.tracks;
        return null;
    }

    /**
     * method used to play music queue tracks only
     * @param guild
     * @returns {*}
     */
    async play(guild)
    {
        let queue = this._queue.get(guild.id);
        let connection = guild.voiceConnection;
        let state = this._state.get(guild.id);
        if (!state) state = this._initDefaultState(guild.id);

        if (!queue || !queue.tracks || queue.tracks.length === 0) return this.emit('play', 'Queue for given guild is empty.', guild);
        if (!connection) return this.emit('play', 'Not connected to voice channel for given guild.', guild);

        if (queue.queue_end_reached === true && state.loop === true) {
            if (state.shuffle === true) this.shuffle(guild);
            else this._resetQueuePosition(guild.id);
            queue = this._queue.get(guild.id);
        } else if (queue.queue_end_reached === true && state.loop === false)
            return this.emit('play', 'Music has finished playing for given guild. Looping is not enabled.', guild);

        let track = queue.tracks[queue.position];
        track['position'] = queue.position;
        track['total'] = queue.tracks.length;

        let stream = ytdl(track.url, {filter: 'audioonly', quality: 'lowest'});
        let dispatcher = connection.playStream(stream);

        dispatcher.on('start', () => {
            state.seek = 0;
            state.increment_queue = true;
            this._state.set(guild.id, state);
            this.emit('playing', track, guild);
        });

        dispatcher.on('end', (reason) => {
            console.log('Dispatcher end event, incrementing queue.', reason);
            // work around existing discord.js bug where dispatcher end event gets emitted twice - sigh
            if (reason) {
                if (state.stop === false) {
                    this._TryToIncrementQueue(guild.id);
                    return this.play(guild);
                }
                return this._initDefaultState(guild);
            } else return this.play(guild);
        });

        dispatcher.on('error', e => {
            console.log(e);
            this._TryToIncrementQueue(guild.id);
            return this.emit('play', `Music player encountered an error trying to play \`${track.title}\``, guild);
        });
    }

    /**
     * @param guild
     * @param position
     */
    removeTrack(guild, position)
    {
        let queue = this._queue.get(guild.id);
        if (position === 0) {
            queue.position = 0;
            queue.tracks = [];
            this._queue.set(guild.id, queue);
            this.emit('remove', `Removing \`ALL\` tracks from the queue. Total: \`${queue.tracks.length}\``, guild);
        } else {
            if (position-1 >= queue.tracks.length) return this.emit('remove', `Invalid track number provided. Allowed: 1-${queue.tracks.length}`, guild);
            this.emit('remove', `Removing \`${queue.tracks[position-1].title}\` from the queue.`, guild);
            let firstHalf = position - 1 === 0 ? [] : queue.tracks.splice(0, position - 1);
            let secondHalf = queue.tracks.splice(position-1 === 0 ? position : position-1, queue.tracks.length);
            queue.tracks = firstHalf.concat(secondHalf);
            this._queue.set(guild.id, queue);
        }
    }

    /**
     * TODO: test this
     * @param guild
     */
    shuffle(guild)
    {
        this._resetQueuePosition(guild.id);
        let queue = this._queue.get(guild.id);
        if (queue) {
            if (queue.tracks.length >= 2) {
                queue.tracks = this._randomizeArray(queue.tracks);
                this._queue.set(guild.id, queue);
                this.emit('shuffle', `Music Player has shuffled _${queue.tracks.length}_ records`, guild)
            } else this.emit('shuffle', 'Music Player could not shuffle tracks - not enough tracks present', guild)
        } else this.emit('shuffle', 'Music Player could not shuffle track list at the moment.', guild)
    }

    /**
     * @param guild
     */
    pause(guild)
    {
        let connection = guild.voiceConnection;
        if (connection && connection.dispatcher && connection.dispatcher.paused === false) {
            connection.dispatcher.pause();
            this.emit('pause', 'Music Player has been paused', guild)
        } else this.emit('pause', 'Music Player could not be paused. Player is not connected or is already paused at the moment.', guild)
    }

    /**
     * @param guild
     */
    resume(guild)
    {
        let connection = guild.voiceConnection;
        if (connection && connection.dispatcher && connection.dispatcher.paused === true) {
            connection.dispatcher.resume();
            this.emit('resume', 'Music Player has been resumed', guild)
        } else  this.emit('resume', 'Music Player could not be resumed. Player is not connected or is not paused at the moment.', guild)
    }

    /**
     * @param guild
     */
    skip(guild)
    {
        let connection = guild.voiceConnection;
        if (connection && (connection.dispatcher || connection.speaking === true)) {
            connection.dispatcher.end('skip() method initiated');
            return this.emit('skip', 'Music player is skipping.', guild)
        } else this.emit('skip', 'Music Player could not skip track at the moment. Player not connected or is not playing anything yet.', guild)
    }

    /**
     * TODO test this
     * @param guild
     * @param timeInSeconds
     * @param timeString
     */
    seek(guild, timeInSeconds, timeString = `${timeInSeconds/60}:${timeInSeconds%60}`)
    {
        let connection = guild.voiceConnection;
        let state = this._state(guild.id);
        if (state && connection && connection.dispatcher) {
            state.increment_queue = false;
            state.seek = timeInSeconds;
            this._state.set(guild.id, state);

            connection.dispatcher.end('seek() method initiated');
            this.emit('seek', `Seeking player to ${timeString}`, guild);
        } else this.emit('seek', 'Player could not seek. Player not connected or is not playing music at the moment.', guild);
    }

    /**
     * TODO test this
     * @param guild
     * @param position
     * @returns {Emitter|*}
     */
    jump(guild, position)
    {
        let connection = guild.voiceConnection;
        let queue = this._queue.get(guild.id);
        if (connection && connection.dispatcher) {
            if (queue.tracks.length === 0 || queue.tracks.length < position-1)
                return this.emit('info', `Incorrect song number provided. Allowed 1-${queue.tracks.length}]`);

            queue.position = position - 1;
            this._queue.set(guild.id, queue);

            connection.dispatcher.end('jump() method initiated');

            this.emit('jump', `Player jumping to play track \`#${position} [${queue.tracks[position-1].title}]\``, guild);
        } else this.emit('jump', 'Player could jump to specific song. Player not connected or is not playing music at the moment.', guild);
    }

    /**
     * @param guild
     */
    stop(guild)
    {
        let state = this._state.get(guild.id);
        let connection = guild.voiceConnection;
        if (connection && connection.dispatcher) {
            state.stop = true;
            this._state.set(guild.id, state);
            connection.dispatcher.destroy('stop() method initiated');
            this.emit('stop', 'Music player has been stopped.', guild)
        } else this.emit('stop', 'Music Player could not be stopped. Player not connected.', guild)
    }

    /**
     * @param track
     * @param guild
     */
    loadTrack(track, guild)
    {
        this._validateTrackObject(track);

        let queue = this._queue.get(guild.id);
        if (!queue) queue = this._getDefaultQueueObject(guild.id);
        queue.tracks.push(track);

        this._queue.set(guild.id, queue);
    }

    /**
     *
     * @param tracks
     * @param guild
     */
    loadTracks(tracks, guild)
    {
        if (Array.isArray(tracks) === false) throw 'Tracks must be contained in array';
        for (let track of tracks) this._validateTrackObject(track);

        let queue = this._queue.get(guild.id);
        if (!queue) queue = this._getDefaultQueueObject(guild.id);

        queue.tracks = queue.tracks.concat(tracks);
        this._queue.set(guild.id, queue);
    }

    /**
     * @param guildID
     * @private
     */
    _initDefaultState(guildID)
    {
        let state = {
            passes: 2,
            seek: 0,
            volume: 1,
            increment_queue: true,
            loop: true,
            shuffle: true,
            stop: false,
        };
        this._state.set(guildID, state);

        return state;
    }

    /**
     *
     * @param guildID
     * @private
     */
    _TryToIncrementQueue(guildID)
    {
        let queue = this._queue.get(guildID);
        let state = this._state.get(guildID);
        if (!queue) throw 'Can\'t increment queue - map not initialized';

        console.log('Incrementing from', queue.position);
        if (queue.position >= queue.tracks.length-1) queue.queue_end_reached = true;
        else if (!state || state.increment_queue === true) queue.position+=1;

        this._queue.set(guildID, queue);
    }

    /**
     * @param guildID
     * @private
     */
    _resetQueuePosition(guildID)
    {
        let queue = this._queue.get(guildID);
        queue.position = 0;
        queue.queue_end_reached = false;
        this._queue.set(guildID, queue);
    }

    /**
     *
     * @param guildID
     * @returns {{guild_id: *, tracks: Array, position: number}}
     * @private
     */
    _getDefaultQueueObject(guildID)
    {
        return {
            guild_id: guildID,
            tracks: [],
            position: 0,
            queue_end_reached: false,
            created_timestamp: new Date().getTime(),
        }
    }

    /**
     *
     * @param track
     * @returns {boolean}
     * @private
     */
    _validateTrackObject(track)
    {
        if (!track.title) throw 'Track object must specify track name [track.title]';
        if (!track.url) throw 'Track must specify stream url [track.url]';
        if (!track.source) throw 'Track must specify stream source [track.source]';
        if (!track.image) throw 'Track must specify stream image [track.image]';

        return true;
    }

    /**
     *
     * @param array
     * @returns {*}
     * @private
     */
    _randomizeArray(array)
    {
        if (array.length >= 2) {
            for (let i = array.length - 1; i > 0; i--) {
                let j = Math.floor(Math.random() * (i + 1));
                let temp = array[i];
                array[i] = array[j];
                array[j] = temp;
            }
        }
        return array;
    }

};