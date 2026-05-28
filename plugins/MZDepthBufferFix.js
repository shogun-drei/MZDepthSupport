/*:
 * @target MZ
 * @plugindesc Adds WebGL depth buffer support for Effekseer 3D effects.
 * @author shogun_drei
 *
 * @help MZDepthBufferFix.js
 *
 * Load this plugin AFTER EffekseerForRPGMakerMZ_Ex.
 *
 */

(() => {
    "use strict";

    const pluginName = "MZDepthBufferFix";
    const projectionDepthScale = 10.0;

    const logWarn = message => {
        console.warn(`[${pluginName}] ${message}`);
    };

    const depthBuffers = new WeakMap();

    function ensureCanvasDepthContext() {
        const contextSystem = PIXI && PIXI.systems && PIXI.systems.ContextSystem;
        if (!contextSystem || contextSystem.prototype._effekseerDepthPatched) {
            return;
        }

        const _initFromOptions = contextSystem.prototype.initFromOptions;
        contextSystem.prototype.initFromOptions = function(options) {
            const depthOptions = Object.assign({}, options, { depth: true });
            _initFromOptions.call(this, depthOptions);
        };
        contextSystem.prototype._effekseerDepthPatched = true;
    }

    function disposeDepthBuffer(gl) {
        if (!gl) {
            return;
        }
        const entry = depthBuffers.get(gl);
        if (entry && entry.renderbuffer) {
            gl.deleteRenderbuffer(entry.renderbuffer);
        }
        depthBuffers.delete(gl);
    }

    function currentAttachment(gl, attachment) {
        try {
            return gl.getFramebufferAttachmentParameter(
                gl.FRAMEBUFFER,
                attachment,
                gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME
            );
        } catch (e) {
            return null;
        }
    }

    function attachDepthToCurrentFramebuffer(gl, width, height) {
        if (gl.getParameter(gl.FRAMEBUFFER_BINDING) === null) {
            return null;
        }

        const existingDepth = currentAttachment(gl, gl.DEPTH_ATTACHMENT);
        const existingDepthStencil = currentAttachment(gl, gl.DEPTH_STENCIL_ATTACHMENT);
        if (existingDepth || existingDepthStencil) {
            return null;
        }

        const previousRenderbuffer = gl.getParameter(gl.RENDERBUFFER_BINDING);
        let entry = depthBuffers.get(gl);
        if (!entry) {
            entry = { renderbuffer: gl.createRenderbuffer(), width: 0, height: 0 };
            depthBuffers.set(gl, entry);
        }

        gl.bindRenderbuffer(gl.RENDERBUFFER, entry.renderbuffer);
        if (entry.width !== width || entry.height !== height) {
            gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);
            entry.width = width;
            entry.height = height;
        }

        gl.framebufferRenderbuffer(
            gl.FRAMEBUFFER,
            gl.DEPTH_ATTACHMENT,
            gl.RENDERBUFFER,
            entry.renderbuffer
        );

        const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
        gl.bindRenderbuffer(gl.RENDERBUFFER, previousRenderbuffer);

        if (!complete) {
            gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, null);
            logWarn("Skipping render texture depth attachment because the framebuffer became incomplete.");
            return null;
        }

        return { previousRenderbuffer };
    }

    function detachDepthFromCurrentFramebuffer(gl, attachmentState) {
        if (!attachmentState) {
            return;
        }
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, null);
        gl.bindRenderbuffer(gl.RENDERBUFFER, attachmentState.previousRenderbuffer);
    }

    function captureDepthState(gl) {
        return {
            depthWrite: gl.getParameter(gl.DEPTH_WRITEMASK),
            depthTest: gl.isEnabled(gl.DEPTH_TEST),
            depthFunc: gl.getParameter(gl.DEPTH_FUNC),
            clearDepth: gl.getParameter(gl.DEPTH_CLEAR_VALUE),
            frontFace: gl.getParameter(gl.FRONT_FACE)
        };
    }

    function restoreDepthState(gl, state) {
        gl.depthMask(state.depthWrite);
        if (state.depthTest) {
            gl.enable(gl.DEPTH_TEST);
        } else {
            gl.disable(gl.DEPTH_TEST);
        }
        gl.depthFunc(state.depthFunc);
        gl.clearDepth(state.clearDepth);
        gl.frontFace(state.frontFace);
    }

    function renderTextureSize(renderer) {
        const renderTexture = renderer.renderTexture && renderer.renderTexture.current;
        if (renderTexture && renderTexture.baseTexture) {
            const resolution = renderTexture.baseTexture.resolution || 1;
            return {
                width: Math.max(1, Math.round(renderTexture.width * resolution)),
                height: Math.max(1, Math.round(renderTexture.height * resolution))
            };
        }
        return {
            width: renderer.width || renderer.view.width,
            height: renderer.height || renderer.view.height
        };
    }

    function canRenderEffekseerAnimation(sprite) {
        return sprite._targets.length > 0 && sprite._handle && sprite._handle.exists;
    }

    ensureCanvasDepthContext();

    const effekseerParams = PluginManager.parameters("EffekseerForRPGMakerMZ_Ex");
    const distortionEnabled =
        effekseerParams.DistortionEnabled !== undefined &&
        effekseerParams.DistortionEnabled !== "false";

    if (!distortionEnabled) {
        Sprite_Animation.prototype.setProjectionMatrix = function(renderer) {
            const x = this._mirror ? -1 : 1;
            const y = -1;
            const p = -(this._viewportSize / renderer.view.height);
            const depthCorrection = projectionDepthScale / p;

            Graphics.effekseer.setProjectionMatrix([
                x, 0, 0, 0,
                0, y, 0, 0,
                0, 0, 1.0, p,
                0, 0, depthCorrection, 1.0
            ]);
        };
    }

    const _Graphics_createPixiApp = Graphics._createPixiApp;
    Graphics._createPixiApp = function() {
        disposeDepthBuffer(this._app && this._app.renderer && this._app.renderer.gl);
        _Graphics_createPixiApp.call(this);

        const gl = this._app && this._app.renderer && this._app.renderer.gl;
        const attributes = gl && gl.getContextAttributes && gl.getContextAttributes();
        if (attributes && !attributes.depth) {
            logWarn("The WebGL context was created without a canvas depth buffer. Load this plugin before Graphics initializes.");
        }
    };

    const _Sprite_Animation_render = Sprite_Animation.prototype._render;
    Sprite_Animation.prototype._render = function(renderer) {
        if (!canRenderEffekseerAnimation(this)) {
            _Sprite_Animation_render.call(this, renderer);
            return;
        }

        const gl = renderer.gl;
        const state = captureDepthState(gl);
        const size = renderTextureSize(renderer);
        const attachmentState = attachDepthToCurrentFramebuffer(gl, size.width, size.height);

        try {
            gl.depthMask(true);
            gl.clearDepth(1.0);
            gl.clear(gl.DEPTH_BUFFER_BIT);
            gl.enable(gl.DEPTH_TEST);
            gl.depthFunc(gl.LEQUAL);

            gl.frontFace(state.frontFace === gl.CW ? gl.CCW : gl.CW);

            _Sprite_Animation_render.call(this, renderer);
        } finally {
            restoreDepthState(gl, state);
            detachDepthFromCurrentFramebuffer(gl, attachmentState);
        }
    };
})();
